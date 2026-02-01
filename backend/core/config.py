import logging
import os
from typing import Any

from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)

REQUIRED_ENV_VARS = (
    "DATABASE_URL",
    "JWT_SECRET_KEY",
    "JWT_ALGORITHM",
    "JWT_EXPIRE_MINUTES",
    "KYC_AUTH_MODE",
    "KYC_ADMIN_KEY",
    "THRONOS_ADMIN_SECRET",
)

FORBIDDEN_DB_ENV_VARS = (
    "DB_URL",
    "POSTGRES_URL",
    "INTERNAL_DB_URL",
    "SUPABASE_DB_URL",
)

OIDC_ENV_VARS = (
    "OIDC_ISSUER_URL",
    "OIDC_CLIENT_ID",
    "OIDC_CLIENT_SECRET",
    "OIDC_SCOPE",
)


class Settings(BaseSettings):
    # Application
    app_name: str = "FastAPI Modular Template"
    debug: bool = False
    version: str = "1.0.0"

    # Database
    database_url: str | None = None

    # Server
    host: str = "0.0.0.0"
    port: int = 8000

    # AWS Lambda Configuration
    is_lambda: bool = False
    lambda_function_name: str = "fastapi-backend"
    aws_region: str = "us-east-1"

    # Environment
    environment: str = "development"  # development, staging, production

    # Thronos Blockchain Configuration
    thronos_node1_url: str = "https://thrchain.up.railway.app"
    thronos_node2_url: str = "https://node-2.up.railway.app"
    thronos_cdn_url: str = "https://thrchain.vercel.app"
    thronos_ai_core_url: str = "https://thronos-v3-6.onrender.com"
    thronos_admin_secret: str = ""

    @property
    def backend_url(self) -> str:
        """Generate backend URL from host and port."""
        if self.is_lambda:
            # In Lambda environment, return the API Gateway URL
            return os.environ.get(
                "PYTHON_BACKEND_URL", f"https://{self.lambda_function_name}.execute-api.{self.aws_region}.amazonaws.com"
            )
        else:
            # Use localhost for external callbacks instead of 0.0.0.0
            display_host = "127.0.0.1" if self.host == "0.0.0.0" else self.host
            return os.environ.get("PYTHON_BACKEND_URL", f"http://{display_host}:{self.port}")

    class Config:
        case_sensitive = False
        extra = "ignore"

    def __getattr__(self, name: str) -> Any:
        """
        Dynamically read attributes from environment variables.
        For example: settings.opapi_key reads from OPAPI_KEY environment variable.

        Args:
            name: Attribute name (e.g., 'opapi_key')

        Returns:
            Value from environment variable

        Raises:
            AttributeError: If attribute doesn't exist and not found in environment variables
        """
        # Convert attribute name to environment variable name (snake_case -> UPPER_CASE)
        env_var_name = name.upper()

        # Check if environment variable exists
        if env_var_name in os.environ:
            value = os.environ[env_var_name]
            # Cache the value in instance dict to avoid repeated lookups
            self.__dict__[name] = value
            logger.debug(f"Read dynamic attribute {name} from environment variable {env_var_name}")
            return value

        # If not found, raise AttributeError to maintain normal Python behavior
        raise AttributeError(f"'{self.__class__.__name__}' object has no attribute '{name}'")


# Global settings instance
settings = Settings()


def validate_environment() -> None:
    """Validate required environment variables for boot."""
    missing = [name for name in REQUIRED_ENV_VARS if not os.getenv(name)]
    if missing:
        raise ValueError(f"Missing required environment variables: {', '.join(missing)}")

    forbidden = [name for name in FORBIDDEN_DB_ENV_VARS if os.getenv(name)]
    if forbidden:
        raise ValueError(
            "Forbidden database environment variables are set: "
            f"{', '.join(forbidden)}. Use only DATABASE_URL."
        )

    jwt_algorithm = os.getenv("JWT_ALGORITHM")
    if jwt_algorithm != "HS256":
        raise ValueError("JWT_ALGORITHM must be set to HS256")

    auth_mode = os.getenv("KYC_AUTH_MODE", "").strip().lower()
    if auth_mode == "oidc":
        for var in OIDC_ENV_VARS:
            if not os.getenv(var):
                raise ValueError(f"Missing env {var} for OIDC mode")
