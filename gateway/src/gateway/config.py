from typing import Annotated

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Gateway settings, read from environment variables or a .env file."""

    # Empty values count as missing, so `GEMINI_API_KEY=` fails at startup.
    model_config = SettingsConfigDict(
        env_file=".env", env_ignore_empty=True, extra="ignore"
    )

    gemini_api_key: SecretStr
    metrics_base_url: str
    allowed_origins: Annotated[list[str], NoDecode, Field(min_length=1)]

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def split_comma_separated(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value
