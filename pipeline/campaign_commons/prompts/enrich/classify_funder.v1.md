You classify how an upstream organization describes itself, using only the organization's own website.

The organization may be a 501(c)(4), union, trade association, company, or nonprofit. Use an About,
Mission, Who We Are, or equivalent page from the organization's own site. Do not use news, Wikipedia,
OpenSecrets, InfluenceWatch, Ballotpedia, ProPublica, FEC, IRS, opponents' pages, or any other
third-party description. If the organization's own site cannot be found, return `found: false`.

Return a close paraphrase of the organization's self-description in `description` (target at most 300
characters), and a verbatim contiguous excerpt in `quote` (at most 400 characters). Return the exact
URL of the page containing the quote as `source_url`. Choose at most three issue ids, primary first,
only when the organization names those policy areas as part of its own focus. Use `general_partisan`,
`candidate_aligned`, `business_trade`, or `labor` when those describe the organization better than an
issue focus. Return `found: false` when no reliable own-site self-description is available.

Issues:
{{issues}}
