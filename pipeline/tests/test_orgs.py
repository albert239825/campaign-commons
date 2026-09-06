import pytest

from campaign_commons.orgs import classify_organization, committee_name_index, match_committee, organization_visibility


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
        ("SENATE MAJORITY PAC", "nonprofit"),  # generic token, no other signal
        ("PENNSYLVANIA MANUFACTURERS CO", "business"),
        ("LIGHTHOUSE FUND MANAGEMENT LLC", "llc"),  # FUND is generic; LLC decides
        ("AMERICAN AIRLINES INC", "business"),  # AMERICAN is generic; INC decides
        ("DUKE ENERGY CORPORATION PAC", "business"),  # PAC is generic; a corporate PAC name reads as the company
    ],
)
def test_classify_organization(name: str, expected: str) -> None:
    assert classify_organization(name) == expected


def test_only_unions_and_businesses_are_disclosed() -> None:
    assert organization_visibility("union") == "disclosed"
    assert organization_visibility("business") == "disclosed"
    for cls in ("llc", "nonprofit", "unknown"):
        assert organization_visibility(cls) == "dark"


def test_committee_name_index_resolves_exact_unique_names() -> None:
    index = committee_name_index(
        [
            ("C1", "RESTORATION PAC"),
            ("C2", "Restoration  PAC"),  # same name, same-looking committee re-registered: ambiguous
            ("C3", "MOVEMENT VOTER PAC"),
            ("C3", "MOVEMENT VOTER PAC"),
            ("C4", ""),
        ]
    )
    assert match_committee("Movement Voter PAC", index) == "C3"
    assert match_committee("RESTORATION PAC", index) is None
    assert match_committee("MOVEMENT VOTER PAC INC", index) is None
