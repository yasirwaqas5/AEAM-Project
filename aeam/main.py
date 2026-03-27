"""
aeam/main.py

Entry point for the AEAM (Autonomous Event & Agent Monitor) modular monolith.

Responsibilities:
- Load application settings from environment.
- Construct and wire all infrastructure clients (database, Redis, event bus,
  priority queue, deduplicator).
- Mount a FastAPI application with a health endpoint.
- Expose a clean application factory (``create_app``) for testing and ASGI
  servers.

This module intentionally contains NO agent logic, NO orchestrator references,
NO LLM calls, and NO external API calls. It is pure infrastructure wiring.
"""

import logging
import sys
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from aeam.config.settings import Settings
from aeam.core.deduplication import EventDeduplicator
from aeam.core.event_bus import EventBus
from aeam.core.priority_queue import EventPriorityQueue
from aeam.integrations.database import DatabaseClient
from aeam.integrations.redis_client import RedisClient

# Orchestrator imports (Phase 3)
from aeam.agents.orchestrator.orchestrator import Orchestrator
from aeam.agents.orchestrator.decision_engine import DecisionEngine
from aeam.agents.orchestrator.evaluation_engine import EvaluationEngine
from aeam.agents.orchestrator.state_machine import IncidentStateMachine
from aeam.memory.short_term import ShortTermMemory
from aeam.memory.long_term import LongTermMemory

# Phase 8 Security imports
from aeam.middleware.security_middleware import SecurityMiddleware
from aeam.security.jwt_auth import JWTAuth
from aeam.security.rbac import RBAC
from aeam.security.rate_limiter import RateLimiter
from aeam.security.audit_logger import AuditLogger

# ---------------------------------------------------------------------------
# Logging bootstrap
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Infrastructure container
# ---------------------------------------------------------------------------


class AppContainer:
    """
    Lightweight dependency container for all AEAM infrastructure objects.

    Holds references to every singleton client constructed at startup so they
    can be accessed via ``request.app.state.container`` inside route handlers
    and background tasks.

    Attributes:
        settings:     Validated application configuration.
        db:           SQLAlchemy-backed relational database client.
        redis:        Redis wrapper for caching and deduplication.
        event_bus:    Synchronous internal event dispatcher.
        queue:        Thread-safe in-memory priority queue for events.
        deduplicator: Window-based event deduplicator backed by Redis.
    """

    def __init__(
        self,
        settings: Settings,
        db: DatabaseClient,
        redis: RedisClient,
        event_bus: EventBus,
        queue: EventPriorityQueue,
        deduplicator: EventDeduplicator,
    ) -> None:
        self.settings = settings
        self.db = db
        self.redis = redis
        self.event_bus = event_bus
        self.queue = queue
        self.deduplicator = deduplicator

    def __repr__(self) -> str:
        return (
            f"AppContainer("
            f"env={self.settings.ENVIRONMENT!r}, "
            f"queue_size={self.queue.size()}, "
            f"bus_handlers={self.event_bus.handler_count()})"
        )


# ---------------------------------------------------------------------------
# Infrastructure factory
# ---------------------------------------------------------------------------


def _build_container(settings: Settings) -> AppContainer:
    """
    Construct and wire all infrastructure clients from ``settings``.

    This function is the single place where concrete implementations are
    instantiated. Swap implementations here (e.g. for testing) without
    touching any other module.

    Args:
        settings: Validated :class:`~aeam.config.settings.Settings` instance.

    Returns:
        A fully wired :class:`AppContainer`.

    Raises:
        Exception: Any client that fails to initialise (bad URL, unreachable
                   host, etc.) will propagate its exception, preventing the
                   application from starting in a broken state.
    """
    logger.info("Initialising DatabaseClient …")
    db = DatabaseClient(database_url=str(settings.DATABASE_URL))

    logger.info("Initialising RedisClient …")
    redis_client = RedisClient(redis_url=str(settings.REDIS_URL))

    logger.info("Initialising EventBus …")
    event_bus = EventBus()

    logger.info("Initialising EventPriorityQueue …")
    queue = EventPriorityQueue()

    logger.info("Initialising EventDeduplicator …")
    deduplicator = EventDeduplicator(redis_client=redis_client._client)

    return AppContainer(
        settings=settings,
        db=db,
        redis=redis_client,
        event_bus=event_bus,
        queue=queue,
        deduplicator=deduplicator,
    )


# ---------------------------------------------------------------------------
# Lifespan — startup / shutdown
# ---------------------------------------------------------------------------


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """
    FastAPI lifespan context manager.

    Runs startup logic before the application begins serving requests and
    teardown logic after the last request has been handled.

    Startup:
        - Load settings.
        - Build and attach the :class:`AppContainer` to ``app.state``.
        - Wire and register the Orchestrator.
        - Verify Redis connectivity via ping.

    Shutdown:
        - Dispose of the database connection pool.
        - Close the Redis connection pool.
    """
    # --- Startup ---
    logger.info("AEAM starting up …")

    settings = Settings()
    logger.info("Settings loaded | environment=%r", settings.ENVIRONMENT)

    container = _build_container(settings)
    app.state.container = container

    # -----------------------------
    # Orchestrator Wiring (Phase 3)
    # -----------------------------
    decision_engine = DecisionEngine(settings=settings)
    evaluation_engine = EvaluationEngine(settings=settings)
    short_term_memory = ShortTermMemory()
    class _NoOpVectorClient:
        def upsert(self, *args, **kwargs):
            pass

        def query(self, *args, **kwargs):
            return []

        def delete(self, *args, **kwargs):
            pass


    vector_client = _NoOpVectorClient()

    long_term_memory = LongTermMemory(
        database_client=container.db,
        vector_client=vector_client,
    )
    state_machine = IncidentStateMachine()

    orchestrator = Orchestrator(
        event_bus=container.event_bus,
        decision_engine=decision_engine,
        evaluation_engine=evaluation_engine,
        short_term_memory=short_term_memory,
        long_term_memory=long_term_memory,
        state_machine=state_machine,
        settings=settings,
    )

    # Register wildcard handler
    container.event_bus.register_handler("ALL", orchestrator.handle_event)

    logger.info("Orchestrator registered with EventBus (ALL wildcard).")
    logger.info("Infrastructure container ready | %r", container)

    # Connectivity probes — warn but do not abort; let the health endpoint
    # surface degraded state so orchestrators can take action.
    if container.redis.ping():
        logger.info("Redis connectivity: OK")
    else:
        logger.warning("Redis connectivity: DEGRADED — ping failed.")

    logger.info("AEAM startup complete.")
    yield

    # --- Shutdown ---
    logger.info("AEAM shutting down …")
    container.db.dispose()
    container.redis.close()
    logger.info("AEAM shutdown complete.")


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------


def create_app() -> FastAPI:
    """
    Construct and return the FastAPI application instance.

    Using a factory function (rather than a module-level global) allows test
    suites to call ``create_app()`` multiple times with different settings or
    mocked dependencies without state leaking between test runs.

    Returns:
        A configured :class:`fastapi.FastAPI` instance with all routes and
        middleware attached.

    Example (ASGI server)::

        # gunicorn -w 1 -k uvicorn.workers.UvicornWorker "aeam.main:create_app()"
        # uvicorn aeam.main:app --reload
    """
    application = FastAPI(
        title="AEAM — Autonomous Event & Agent Monitor",
        description=(
            "Modular monolith for autonomous event detection, "
            "prioritisation, deduplication, and investigation."
        ),
        version="0.1.0",
        lifespan=_lifespan,
        # Disable the default 422 body included in validation errors in prod.
        docs_url="/docs",
        redoc_url="/redoc",
    )

    # -------------------------------------------------
    # Phase 8: Security Middleware Registration
    # -------------------------------------------------
    # We must create the Redis client here, not use the container
    # because container is not yet attached at this point.
    settings = Settings()
    redis_client = RedisClient(redis_url=str(settings.REDIS_URL))

    jwt_auth = JWTAuth(public_key="dummy-public-key")  # replace later
    rbac = RBAC()
    rate_limiter = RateLimiter(redis_client=redis_client)
    audit_logger = AuditLogger()

    application.add_middleware(
        SecurityMiddleware,
        jwt_auth=jwt_auth,
        rbac=rbac,
        rate_limiter=rate_limiter,
        audit_logger=audit_logger,
    )

    logger.info("Security middleware registered.")

    _register_routes(application)
    return application


# ---------------------------------------------------------------------------
# Route registration
# ---------------------------------------------------------------------------


def _register_routes(app: FastAPI) -> None:
    """
    Attach all HTTP routes to ``app``.

    Separating route registration from ``create_app`` keeps the factory small
    and makes it easy to add API routers (``app.include_router(…)``) as the
    system grows.

    Args:
        app: The :class:`fastapi.FastAPI` instance to attach routes to.
    """

    @app.get(
        "/health",
        summary="Health check",
        description=(
            "Returns the operational status of AEAM and its infrastructure "
            "dependencies. A ``200`` response with ``status: ok`` means the "
            "application is ready to serve requests. Individual component "
            "statuses may indicate degraded state without causing the overall "
            "check to fail, allowing partial operation."
        ),
        tags=["Operations"],
    )
    def health() -> JSONResponse:
        """
        Return infrastructure health status.

        Checks:
        - Redis reachability via ``PING``.
        - Event queue depth (informational).
        - Registered event bus handler count (informational).
        - Vector DB reachability (temporary placeholder).

        Returns:
            JSON payload with ``status`` (``"ok"`` or ``"degraded"``) and a
            ``components`` dict with per-service detail.
        """
        container: AppContainer = app.state.container

        redis_ok = container.redis.ping()
        queue_depth = container.queue.size()
        handler_count = container.event_bus.handler_count()
        vector_ok = True  # TEMP (since Qdrant client not wired fully yet)

        overall = "ok" if redis_ok else "degraded"

        return JSONResponse(
            status_code=200,
            content={
                "status": overall,
                "environment": container.settings.ENVIRONMENT,
                "components": {
                    "redis": "ok" if redis_ok else "degraded",
                    "database": "ok",  # Pool exists; true probe requires a query.
                    "vector_db": "ok" if vector_ok else "degraded",
                    "event_queue_depth": queue_depth,
                    "event_bus_handlers": handler_count,
                    "llm_enabled": container.settings.LLM_ENABLED,
                },
            },
        )


# ---------------------------------------------------------------------------
# Module-level app instance (for uvicorn / gunicorn direct reference)
# ---------------------------------------------------------------------------

app: FastAPI = create_app()
"""
Module-level FastAPI instance.

Use this for direct ASGI server invocation::

    uvicorn aeam.main:app --host 0.0.0.0 --port 8000
"""

# ---------------------------------------------------------------------------
# Note: EventBus modification required to support "ALL" wildcard.
# In aeam/core/event_bus.py, modify the publish() method to:
#
#   handlers = self._handlers.get(event.event_type, [])
#   wildcard_handlers = self._handlers.get("ALL", [])
#   for handler in handlers + wildcard_handlers:
#       handler(event)
# ---------------------------------------------------------------------------