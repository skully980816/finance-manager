"""Australian tax helpers (resident rates).

These are estimates for the *set-aside* engine, not lodgement advice.
Update brackets each FY. FY runs 1 Jul – 30 Jun.
"""
from datetime import date

# Resident income tax brackets FY2024-25 (Stage 3). [upper_limit, base_tax, marginal_rate]
BRACKETS_2024_25 = [
    (18_200, 0, 0.0),
    (45_000, 0, 0.16),
    (135_000, 4_288, 0.30),
    (190_000, 31_288, 0.37),
    (float("inf"), 51_638, 0.45),
]

# Medicare levy (simplified, ignores low-income thresholds/surcharge).
MEDICARE_LEVY = 0.02


def fy_bounds(today: date | None = None) -> tuple[date, date]:
    """Return (start, end) of the Australian financial year containing `today`."""
    today = today or date.today()
    if today.month >= 7:
        return date(today.year, 7, 1), date(today.year + 1, 6, 30)
    return date(today.year - 1, 7, 1), date(today.year, 6, 30)


def income_tax(taxable_income: float, brackets=BRACKETS_2024_25) -> float:
    """Total income tax (excl. Medicare) on a taxable income, in dollars."""
    if taxable_income <= 0:
        return 0.0
    prev_limit = 0.0
    for upper, base, rate in brackets:
        if taxable_income <= upper:
            # find the base for the bracket the income falls into
            return base + (taxable_income - prev_limit) * rate
        prev_limit = upper
    return 0.0


def _bracket_lower(income: float, brackets=BRACKETS_2024_25) -> float:
    prev = 0.0
    for upper, _base, _rate in brackets:
        if income <= upper:
            return prev
        prev = upper
    return prev


def marginal_rate(income: float, brackets=BRACKETS_2024_25) -> float:
    prev = 0.0
    for upper, _base, rate in brackets:
        if income <= upper:
            return rate
        prev = upper
    return brackets[-1][2]


def estimate_tax_setaside(
    taxed_income: float,      # gross income that already had PAYG withheld (payroll)
    tax_already_withheld: float,
    untaxed_income: float,    # sole-trader + interest + dividends + taxable cap gains
    flat_rate: float | None = None,
) -> dict:
    """Estimate how much to set aside for the ATO on untaxed income.

    Strategy:
    - If a flat_rate is provided, set aside flat_rate * untaxed_income.
    - Otherwise compute the *incremental* tax (incl. Medicare) that the untaxed
      income adds on top of taxed income, which is the honest amount owed.
    """
    if flat_rate is not None:
        setaside = untaxed_income * flat_rate
        return {
            "method": "flat",
            "rate": flat_rate,
            "untaxed_income": round(untaxed_income, 2),
            "setaside": round(max(setaside, 0), 2),
        }

    total = taxed_income + untaxed_income
    tax_with = income_tax(total) + total * MEDICARE_LEVY
    tax_without = income_tax(taxed_income) + taxed_income * MEDICARE_LEVY
    incremental = tax_with - tax_without
    # account already withheld on payroll covers the taxed portion already;
    # the set-aside is the incremental tax on the untaxed income.
    setaside = max(incremental, 0)
    return {
        "method": "marginal",
        "marginal_rate": marginal_rate(total),
        "estimated_total_tax": round(tax_with, 2),
        "tax_already_withheld": round(tax_already_withheld, 2),
        "untaxed_income": round(untaxed_income, 2),
        "setaside": round(setaside, 2),
    }
