"""Ranking for ig-audience-insights output, per the rule in CLAUDE.md.

Posts are ordered by comments / likes, not by reach or likes + comments:
reach measures distribution, a comment measures someone who stopped.
"""
from __future__ import annotations

DEFAULT_MIN_LIKES = 50


def rank_by_comment_ratio(posts: list[dict], min_likes: int = DEFAULT_MIN_LIKES) -> dict:
    """Split posts into ranked and skipped, adding a ``comment_ratio`` field.

    Posts with fewer than ``min_likes`` likes are skipped (a tiny sample
    distorts the ratio) and returned separately so the report can say so.
    """
    ranked, skipped = [], []
    for p in posts:
        likes = p.get("likes") or 0
        comments = p.get("comments") or 0
        if likes < min_likes:
            skipped.append(p)
            continue
        ranked.append({**p, "comment_ratio": round(comments / likes, 4)})
    ranked.sort(key=lambda p: p["comment_ratio"], reverse=True)
    return {"ranked": ranked, "skipped": skipped, "min_likes": min_likes}
