from claudemeter.format import format_tokens, format_dollars


def test_format_tokens_under_thousand():
    assert format_tokens(0, auto=True) == "0"
    assert format_tokens(999, auto=True) == "999"


def test_format_tokens_thousands():
    assert format_tokens(1500, auto=True) == "1.5K"
    assert format_tokens(12345, auto=True) == "12.3K"


def test_format_tokens_millions():
    assert format_tokens(1_500_000, auto=True) == "1.5M"
    assert format_tokens(273_970_000, auto=True) == "274.0M"


def test_format_tokens_billions():
    assert format_tokens(1_034_369_000, auto=True) == "1.03B"


def test_format_tokens_raw():
    assert format_tokens(1_500_000, auto=False) == "1,500,000"


def test_format_dollars_normal():
    assert format_dollars(190.87) == "$190.87"
    assert format_dollars(0.5) == "$0.50"


def test_format_dollars_zero():
    assert format_dollars(0) == "$0.00"


def test_format_dollars_large():
    assert format_dollars(1234.5) == "$1,234.50"
