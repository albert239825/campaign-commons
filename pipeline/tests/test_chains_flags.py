"""transfer_mismatch suppression for a campaign's own joint fundraising committee (D-41)."""

from campaign_commons.chains_flags import CommitteeMeta, is_own_jfc_pair

CASEY, CASEY_JFC = "C00431056", "C00545830"
MCCORMICK, MCCORMICK_JFC, THUNE_JFC = "C00851980", "C00828202", "C00700000"
PAC, OTHER_JFC = "C00000001", "C00000002"

META = {
    CASEY: CommitteeMeta("P", "S6PA00217", "CASEY KEYSTONE VICTORY FUND", "BOB CASEY FOR SENATE INC"),
    CASEY_JFC: CommitteeMeta("J", "S6PA00217", "NONE", "CASEY KEYSTONE VICTORY FUND"),
    MCCORMICK: CommitteeMeta("P", "S2PA00661", "2024 THUNE REPUBLICAN SENATE VICTORY", "FRIENDS OF DAVE MCCORMICK"),
    MCCORMICK_JFC: CommitteeMeta("J", None, "NONE", "MCCORMICK VICTORY FUND"),
    THUNE_JFC: CommitteeMeta("J", None, None, "2024 THUNE REPUBLICAN SENATE VICTORY"),
    PAC: CommitteeMeta("U", None, None, "SOME PAC"),
    OTHER_JFC: CommitteeMeta("J", None, None, "FETTERMAN VICTORY FUND"),
}
SURNAMES = {"S6PA00217": "CASEY", "S2PA00661": "MCCORMICK"}


def test_same_cand_id_is_own_jfc_either_direction() -> None:
    assert is_own_jfc_pair(CASEY, CASEY_JFC, META, SURNAMES)
    assert is_own_jfc_pair(CASEY_JFC, CASEY, META, SURNAMES)


def test_connected_org_and_surname_match_own_jfc() -> None:
    assert is_own_jfc_pair(MCCORMICK, THUNE_JFC, META, SURNAMES)  # via CONNECTED_ORG_NM
    assert is_own_jfc_pair(MCCORMICK, MCCORMICK_JFC, META, SURNAMES)  # via surname in JFC name


def test_genuine_mismatches_survive() -> None:
    assert not is_own_jfc_pair(CASEY, OTHER_JFC, META, SURNAMES)  # someone else's JFC
    assert not is_own_jfc_pair(CASEY, PAC, META, SURNAMES)  # counterparty is not a JFC
    assert not is_own_jfc_pair(PAC, CASEY_JFC, META, SURNAMES)  # neither side is a principal committee
    assert not is_own_jfc_pair(CASEY, "C99999999", META, SURNAMES)  # unknown committee
