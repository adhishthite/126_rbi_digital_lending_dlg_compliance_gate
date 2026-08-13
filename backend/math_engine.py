

def calculate_dlg_cap(total_portfolio_amount: float) -> float:
    """
    Calculate the 5% DLG cap limit based on the total portfolio volume.
    """
    return total_portfolio_amount * 0.05


def calculate_payout_utilization(
    cumulative_payout: float, current_payout_requested: float, dlg_cap: float
) -> float:
    """
    Calculate payout utilization rate as a fraction (0.0 to 1.0+).
    """
    if dlg_cap <= 0:
        return 0.0
    return (cumulative_payout + current_payout_requested) / dlg_cap


def calculate_remaining_buffer(
    dlg_cap: float, cumulative_payout: float, current_payout_requested: float
) -> float:
    """
    Calculate the remaining DLG buffer.
    """
    return dlg_cap - (cumulative_payout + current_payout_requested)


def calculate_recovery_allocation(
    recovered_amount: float, claimed_payout_amount: float
) -> dict[str, float]:
    """
    Implement co-lending split logic (80:20 RE-NBFC) for default recoveries.
    Recovered amounts replenishment goes first to the DLG pool (up to the claimed payout amount)
    and the rest is split 80:20.
    """
    replenished_to_dlg = min(recovered_amount, claimed_payout_amount)
    remaining_recovery = max(0.0, recovered_amount - replenished_to_dlg)

    re_share = remaining_recovery * 0.80
    nbfc_share = remaining_recovery * 0.20

    return {
        "replenished_to_dlg": replenished_to_dlg,
        "remaining_recovery": remaining_recovery,
        "re_share": re_share,
        "nbfc_share": nbfc_share,
    }
