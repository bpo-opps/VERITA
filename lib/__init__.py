"""Read-only helpers from sergebulaev/instagram-skills (MIT, upstream 313ef29).

Only the Apify read layer and the URL parser are vendored. The Publora
publishing client, image backends and publish() are intentionally left out:
nothing in this package can post to Instagram.
"""
from ._env import load_env

# Load .env before any client reads os.environ.
load_env()

from .url_parser import parse_instagram_url
from .apify_client import ApifyClient, ApifyError, ApifyAuthError
from .ranking import rank_by_comment_ratio

__all__ = [
    "parse_instagram_url",
    "ApifyClient",
    "ApifyError",
    "ApifyAuthError",
    "rank_by_comment_ratio",
]
