import pytest

from gotham.orgs import classify_organization, organization_visibility


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("UNITED BROTHERHOOD OF CARPENTERS AND JOINERS", "union"),
        ("SEIU LOCAL 2015", "union"),
        ("KOCH INDUSTRIES INC.", "business"),
        ("CHEVRON CORPORATION", "business"),
        ("RIPPLE LABS INC", "business"),
        ("IN PURSUIT OF LLC", "llc"),
        ("ANTONIO J GRACIAS REVOCABLE TRUST", "llc"),
        ("PARADIGM OPERATIONS LP", "llc"),
        ("LEAGUE OF CONSERVATION VOTERS, INC.", "nonprofit"),  # incorporated 501(c)(4): INC does not win
        ("EVERYTOWN FOR GUN SAFETY ACTION FUND INC", "nonprofit"),
        ("ONE NATION", "unknown"),  # no name signal; still dark (see below)
        ("MAJORITY FORWARD", "nonprofit"),
        ("U.S. CHAMBER OF COMMERCE", "nonprofit"),
        ("COINBASE", "unknown"),
    ],
)
def test_classify_organization(name: str, expected: str) -> None:
    assert classify_organization(name) == expected


def test_only_unions_and_businesses_are_disclosed() -> None:
    assert organization_visibility("union") == "disclosed"
    assert organization_visibility("business") == "disclosed"
    for cls in ("llc", "nonprofit", "unknown"):
        assert organization_visibility(cls) == "dark"
