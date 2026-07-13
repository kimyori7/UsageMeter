from __future__ import annotations


def format_tokens(value: int, *, auto: bool) -> str:
    if not auto:
        return f"{value:,}"
    if value >= 1_000_000_000:
        return f"{value / 1_000_000_000:.2f}B"
    if value >= 1_000_000:
        return f"{value / 1_000_000:.1f}M"
    if value >= 1_000:
        return f"{value / 1_000:.1f}K"
    return str(value)


def format_dollars(value: float) -> str:
    return f"${value:,.2f}"
