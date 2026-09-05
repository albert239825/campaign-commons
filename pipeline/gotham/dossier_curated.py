"""Hand-curated inputs for the dossier stage. Everything here is a literal so a human can review and edit it.

- CASEY_ROLL_CALLS: (congress, session, roll number) -> issue ids. Vote, question, title, result and date are NOT
  written here; dossier.py fetches them from the senate.gov XML for that roll call.
- CASEY_BILLS: congress.gov bill id ("S.<n>-<congress>") -> issue ids. Title/introduced date/latest action come from the
  congress.gov API; a bill id that the API does not return for Casey is an error.
- CASEY_POSITIONS: one hand-written descriptive sentence per issue, written from the fetched record.
- MCCORMICK_SNAPSHOT / MCCORMICK_STATEMENTS: a 2024 Wayback snapshot of the campaign issues page and, per issue, the
  section heading, a verbatim excerpt (<= 40 words; dossier.py verifies it appears in the archived page) and a neutral
  one-sentence paraphrase.

Issue ids must be members of contracts/src/issues.ts (mirrored in gotham.config.ISSUE_IDS).
"""

from __future__ import annotations

from dataclasses import dataclass

CASEY_CONGRESS_URL = "https://www.congress.gov/member/robert-casey/C001070"

CASEY_ROLL_CALLS: dict[tuple[int, int, int], tuple[str, ...]] = {
    # 117th Congress
    (117, 1, 74): ("labor_trade",),  # Sanders $15 minimum wage motion, H.R. 1319
    (117, 1, 226): ("tech_ai",),  # S. 1260 U.S. Innovation and Competition Act, passage
    (117, 2, 65): ("abortion",),  # H.R. 3755 Women's Health Protection Act, cloture on motion to proceed
    (117, 2, 170): ("abortion",),  # S. 4132 Women's Health Protection Act, cloture on motion to proceed
    (117, 2, 191): ("defense",),  # H.R. 7691 Ukraine supplemental appropriations, passage
    (117, 2, 230): ("healthcare", "defense"),  # H.R. 3967 Honoring our PACT Act, passage
    (117, 2, 242): ("guns",),  # S. 2938 Bipartisan Safer Communities Act, motion to concur (final)
    (117, 2, 271): ("tech_ai",),  # H.R. 4346 CHIPS and Science Act, motion to concur (final)
    (117, 2, 303): ("energy_climate",),  # Kennedy amdt: require OCS oil and gas lease sales, H.R. 5376
    (117, 2, 325): ("healthcare", "energy_climate", "tax_budget"),  # H.R. 5376 Inflation Reduction Act, passage
    (117, 2, 413): ("immigration",),  # Lee amdt: bar funds to end Title 42 expulsions, H.R. 2617
    # 118th Congress
    (118, 1, 98): ("energy_climate",),  # S.J.Res. 11 disapproving EPA heavy-duty vehicle NOx rule
    (118, 1, 109): ("labor_trade", "energy_climate"),  # H.J.Res. 39 disapproving Commerce solar-import duty moratorium
    (118, 1, 130): ("immigration",),  # S.J.Res. 18 disapproving DHS "Public Charge" rule
    (118, 1, 138): ("immigration",),  # Marshall amdt: border security, H.R. 3746
    (118, 1, 146): ("tax_budget",),  # H.R. 3746 Fiscal Responsibility Act (debt ceiling), passage
    (118, 1, 171): ("guns",),  # H.J.Res. 44 disapproving ATF stabilizing-brace rule
    (118, 1, 260): ("crypto_fintech",),  # S.J.Res. 32 disapproving CFPB small-business lending data rule
    (118, 1, 303): ("energy_climate",),  # S.J.Res. 38 disapproving FHWA greenhouse-gas performance measure
    (118, 1, 312): ("tax_budget",),  # H.R. 6363 further continuing appropriations FY2024, passage
    (118, 1, 343): ("defense",),  # H.R. 2670 FY2024 NDAA conference report
    (118, 2, 39): ("immigration",),  # H.R. 815 border/national security package, cloture on motion to proceed
    (118, 2, 122): ("labor_trade",),  # H.J.Res. 98 disapproving NLRB joint-employer rule
    (118, 2, 142): ("energy_climate",),  # S. 4072 bar funds for EPA vehicle emissions rules, passage
    (118, 2, 150): ("tech_ai",),  # H.R. 7888 Reforming Intelligence and Securing America Act (FISA), passage
    (118, 2, 154): ("defense",),  # H.R. 815 national security supplemental (Ukraine, Israel, Taiwan), final
    (118, 2, 169): ("crypto_fintech",),  # H.J.Res. 109 disapproving SEC Staff Accounting Bulletin 121
    (118, 2, 176): ("energy_climate",),  # S.J.Res. 58 disapproving DOE energy conservation standards rule
    (118, 2, 182): ("immigration",),  # S. 4361 Border Act, cloture on motion to proceed
    (118, 2, 190): ("abortion",),  # S. 4381 Right to Contraception Act, cloture on motion to proceed
    (118, 2, 211): ("abortion",),  # S. 4554 Reproductive Freedom for Women Act, cloture on motion to proceed
    (118, 2, 230): ("tax_budget",),  # H.R. 7024 Tax Relief for American Families and Workers Act, cloture
    (118, 2, 242): ("abortion",),  # S. 4445 Right to IVF Act, cloture on motion to proceed
}

CASEY_BILLS: dict[str, tuple[str, ...]] = {
    # healthcare
    "S.4671-118": ("healthcare",),  # Capping Prescription Costs Act of 2024
    "S.2456-118": ("healthcare",),  # Protecting Seniors from High Drug Costs Act
    "S.100-118": ("healthcare",),  # Better Care Better Jobs Act
    "S.1110-118": ("healthcare",),  # Rural Hospital Support Act
    "S.842-118": ("healthcare",),  # Medicare and Medicaid Dental, Vision, and Hearing Benefit Act of 2023
    # energy_climate
    "S.3957-117": ("energy_climate",),  # STREAM Act (abandoned mine land reclamation)
    "S.4559-117": ("energy_climate",),  # SUPER Act of 2022 (super pollutants)
    "S.2242-118": ("energy_climate",),  # Safeguarding Domestic Energy Production and Independence Act of 2023
    # defense
    "S.4891-118": ("defense",),  # Stop Copay Overpay Act (TRICARE)
    "S.2516-118": ("defense",),  # Veterans Accessibility Act of 2023
    "S.4369-118": ("defense",),  # Secure Smartports Act of 2024
    # crypto_fintech
    "S.3286-118": ("crypto_fintech",),  # Disclosing Investments in Foreign Adversaries Act of 2023
    # immigration
    "S.3591-118": ("immigration",),  # Stop Fentanyl at the Border Act
    # guns
    "S.2776-118": ("guns",),  # Disarm Hate Act
    "S.1893-118": ("guns",),  # Resources for Victims of Gun Violence Act of 2023
    # tax_budget
    "S.738-118": ("tax_budget",),  # Tax Fairness for Workers Act
    "S.3657-118": ("tax_budget",),  # Child and Dependent Care Tax Credit Enhancement Act of 2024
    "S.3716-118": ("tax_budget",),  # 401Kids Savings Account Act of 2024
    # tech_ai
    "S.262-118": ("tech_ai",),  # Stop Spying Bosses Act
    "S.2419-118": ("tech_ai",),  # No Robot Bosses Act
    "S.2440-118": ("tech_ai",),  # Exploitative Workplace Surveillance and Technologies Task Force Act of 2023
    # labor_trade
    "S.737-118": ("labor_trade",),  # No Tax Breaks for Union Busting (NTBUB) Act
    "S.5016-118": ("labor_trade",),  # Combat Chinese Economic Aggression Act of 2024
    "S.4300-118": ("labor_trade",),  # United States Call Center Worker and Consumer Protection Act of 2024
    "S.1486-117": ("labor_trade",),  # Pregnant Workers Fairness Act
    "S.3304-118": ("labor_trade",),  # Black Lung Benefits Improvement Act of 2023
}

CASEY_POSITIONS: dict[str, str] = {
    "healthcare": (
        "Voted for the Inflation Reduction Act and the PACT Act, and sponsored bills on prescription drug costs, "
        "home- and community-based care, rural hospitals, and Medicare dental, vision and hearing coverage."
    ),
    "energy_climate": (
        "Voted for the Inflation Reduction Act, voted against measures blocking EPA vehicle-emission and highway "
        "greenhouse-gas rules, voted to disapprove a DOE efficiency-standards rule and the solar-import duty "
        "moratorium, voted against requiring offshore lease sales, and sponsored bills on abandoned mine "
        "reclamation and super pollutants."
    ),
    "defense": (
        "Voted for the FY2024 NDAA conference report, the 2022 Ukraine supplemental and the 2024 national security "
        "supplemental, and sponsored bills on TRICARE copays, veterans' accessibility and port security."
    ),
    "crypto_fintech": (
        "Voted to disapprove the SEC's crypto-custody bulletin SAB 121, voted against disapproving the CFPB "
        "small-business lending rule, and sponsored a bill on disclosing investments in foreign adversaries."
    ),
    "immigration": (
        "Voted to advance the February 2024 H.R. 815 border and national security package and the Border Act, "
        "voted against the Title 42, "
        "public-charge and Marshall border amendments, and sponsored the Stop Fentanyl at the Border Act."
    ),
    "abortion": (
        "Voted to advance the Women's Health Protection Act, the Reproductive Freedom for Women Act, "
        "the Right to Contraception Act and the Right to IVF Act."
    ),
    "guns": (
        "Voted for the Bipartisan Safer Communities Act, voted against disapproving the ATF stabilizing-brace rule, "
        "and sponsored the Disarm Hate Act and the Resources for Victims of Gun Violence Act."
    ),
    "tax_budget": (
        "Voted for the Inflation Reduction Act, the Fiscal Responsibility Act and FY2024 continuing appropriations, "
        "voted to advance the Tax Relief for American Families and Workers Act, and sponsored bills on worker "
        "tax deductions, the child and dependent care credit and children's savings accounts."
    ),
    "tech_ai": (
        "Voted for the CHIPS and Science Act, the U.S. Innovation and Competition Act and the 2024 FISA "
        "reauthorization, and sponsored bills on workplace surveillance and automated decision systems."
    ),
    "labor_trade": (
        "Voted to advance a federal minimum wage increase amendment, voted against disapproving the "
        "NLRB joint-employer rule, voted to disapprove the solar-import duty moratorium, and sponsored bills on "
        "union-busting tax deductions, call-center offshoring, pregnant workers and black lung benefits."
    ),
}


@dataclass(frozen=True)
class Statement:
    issue_id: str
    heading: str
    excerpt: str
    position: str


MCCORMICK_SNAPSHOT = ("20241101231854", "https://www.davemccormickpa.com/issues/")

MCCORMICK_STATEMENTS: tuple[Statement, ...] = (
    Statement(
        "healthcare",
        "Supporting Pennsylvania's Veterans",
        "Dave knows that we need to equip our veterans with not just quality health care, but mental health care.",
        "States that veterans need access to quality health care, including mental health care.",
    ),
    Statement(
        "energy_climate",
        "Growing Pennsylvania's Energy Sector",
        'We need market-driven solutions and an "all of the above" energy agenda, not government spending that drives '
        "inflation.",
        "States support for a market-driven, all-of-the-above energy agenda including Pennsylvania natural gas, and "
        "for addressing climate change through adaptation rather than government spending.",
    ),
    Statement(
        "defense",
        "America on the World Stage",
        "As Senator, he'll work to restore America's military might, strengthen our defense industrial base, "
        "reestablish deterrence of our adversaries, and make sure the world knows we're not planning to relinquish "
        "our superpower status anytime soon.",
        "States support for a larger defense budget, a stronger defense industrial base and deterrence of adversaries.",
    ),
    Statement(
        "crypto_fintech",
        "Crypto",
        "American leadership on blockchain and crypto is critical to our economic and national security. They offer "
        "America the chance to lead another generation of innovation, but policymakers must do their part, or this "
        "opportunity will slip away.",
        "States that U.S. leadership in blockchain and crypto is an economic and national security priority that "
        "policymakers should support.",
    ),
    Statement(
        "immigration",
        "Securing Our Border",
        "As Senator, Dave will fight to secure the border, put an end to drug and human trafficking, and support our "
        "border patrol agents with the resources they need to do their jobs.",
        "States he would work to secure the southern border, end drug and human trafficking and increase resources "
        "for Border Patrol agents.",
    ),
    Statement(
        "abortion",
        "Abortion",
        "Dave is pro-life, is opposed to a national abortion ban, and supports exceptions in the cases of rape, "
        "incest, and saving the life of the mother.",
        "States he is pro-life, opposes a national abortion ban and supports exceptions for rape, incest and the "
        "life of the mother.",
    ),
    Statement(
        "guns",
        "Second Amendment",
        "Dave is a strong supporter of the Second Amendment and believes law-abiding citizens have an individual "
        "right to own firearms for self-defense, hunting, collecting, and sport-shooting, for any lawful reason",
        "States support for an individual right to own firearms, alongside school security funding, mental health "
        "programs, enforcement of existing gun laws and background check systems.",
    ),
    Statement(
        "tax_budget",
        "Inflation & the Economy",
        "in the Senate he'll work to rein in government spending, oppose tax increases, and exercise fiscal "
        "responsibility to lessen the burden on the people of the commonwealth.",
        "States he would work to reduce government spending, oppose tax increases and exercise fiscal responsibility.",
    ),
    Statement(
        "tech_ai",
        "Harnessing American Innovation",
        "Today, we need to re-energize innovation, including through improving education in math, science, and "
        "engineering as well as technical skills training, and driving technological and data leadership",
        "States support for re-energizing innovation through STEM education, technical skills training and "
        "technological and data leadership.",
    ),
    Statement(
        "labor_trade",
        "Ending China's Free Rein",
        "Dave introduced a plan to fortify American military and economic strength, thwart China's aggressive "
        "ambitions and protect the homeland through six bans to end China's free ride.",
        "States support for a plan of six bans aimed at reducing U.S. economic dependence on China, including for "
        "lithium batteries and solar panels.",
    ),
)
