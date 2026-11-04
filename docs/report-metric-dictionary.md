# Gestion Auto report metric dictionary v2026-11-02.1

All report amounts are MAD unless the response currency says otherwise. Date ranges are inclusive at the stored timestamp boundary, use `Africa/Casablanca`, and are rounded to two decimal places. Agency scope is always derived from the authenticated owner/staff membership; platform-admin requests require an explicit `supplier` filter.

| Metric | Source | Inclusion/formula | Exclusions |
|---|---|---|---|
| contracts | Booking | non-void/non-cancelled bookings overlapping the requested range | cancelled/void bookings |
| fleetVehicles | Car | count of vehicles owned by the agency | other agencies |
| revenueCollected | RentalPayment | posted rent-purpose credits less posted rent-purpose debits in the payment date range | deposits, pending/reversed entries |
| depositsCollected | RentalPayment | posted deposit-purpose credits less posted deposit-purpose debits in the payment date range | rent, pending/reversed entries |
| expenses | MaintenanceExpense | sum of expense amounts by expense date | other agencies; no cash double-count |
| receivable | Booking + RentalPayment | rental total (`financialSnapshot.rentalTotal`, otherwise legacy `price`) minus posted rent credits | refundable deposit is not rent receivable |
| bookedVehicleDays | Booking | overlap days between booking interval and report interval | void/cancelled bookings |
| fleetCapacityDays | Car + range | agency fleet count multiplied by calendar days in range | maintenance downtime is not yet subtracted |
| utilizationPercent | derived | bookedVehicleDays / fleetCapacityDays × 100 | bounded only by the selected date range |
| invoiceCount/invoicedTotal/invoicedPaid | Invoice | non-voided invoices created in range, totals and posted linked payments | voided invoices |
| estimatedMargin | derived | revenueCollected minus maintenance expenses | not a legal/accounting margin; tax and other costs excluded |

The report response includes `metricDictionaryVersion`, currency, timezone, selected dates, and metrics. CSV export repeats the metric metadata on every row so a downloaded result retains its definition context. This is an operational metric dictionary, not a tax/legal compliance statement.
