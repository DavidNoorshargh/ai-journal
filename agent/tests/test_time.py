from datetime import date

from main import time_windows


def test_defined_phrases_resolve():
    windows = time_windows(date(2026, 10, 24))

    assert windows["last week"] == ("20261017", "20261023")
    assert windows["this day last month"] == ("20260924", "20260924")
    assert windows["last year"] == ("20250101", "20251231")


def test_previous_month_clamps_when_the_day_does_not_exist():
    windows = time_windows(date(2026, 3, 31))

    assert windows["this day last month"] == ("20260228", "20260228")
