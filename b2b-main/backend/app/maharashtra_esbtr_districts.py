# Maharashtra district -> Sub Registrar Office data for eSBTR (see DSS 2.0
# API doc's Annexure 3). SignDesk's own reference table has 33 districts and
# 400+ offices total — this file deliberately covers only 5 major districts
# (Mumbai, Thane, Pune, Nagpur, Nashik) as an initial set, not the full one.
# Extend MAHARASHTRA_DISTRICTS below with the remaining districts from the
# same Annexure when there's time — the shape stays identical, just more
# keys.
#
# Note: the values here are the exact office codes/names from SignDesk's own
# doc (e.g. "IGR113-THN1_HQR SUB REGISTRA THANE URBAN 1") — sent to SignDesk
# verbatim as sub_registrar_office, uppercase per the doc's requirement.

MAHARASHTRA_DISTRICTS: dict[str, list[str]] = {
    "MUMBAI": [
        "IGR182-BOM1_MUMBAI CITY 1 SUB REGISTRAR",
        "IGR183-BOM2_JT SUB REGISTRA MUMBAI CITY 2",
        "IGR184-BBE3_JT SUB REGISTRA MUMBAI CITY 3",
        "IGR186-BDR1_JT SUB REGISTRAR ANDHERI NO 1",
        "IGR187-BDR4_JT SUB REGISTRAR ANDHERI 2",
        "IGR188-BDR9_ANDHERI NO 3 SUB REGISTRAR",
        "IGR189-BDR15_JT SUB REGISTRAR ANDHERI 4",
        "IGR190-BRL1_JT SUB REGISTRAR BORIVALI 1",
        "IGR191-BRL2_JT SUB REGISTRAR BORIVALI 2",
        "IGR192-BRL3_JT SUB REGISTRAR BORIVALI 3",
        "IGR193-BRL4_JT SUB REGISTRAR BORIVALI NO 4",
        "IGR194-BRL5_JT SUB REGISTRAR BORIVALI 5",
        "IGR195-BRL6_JT SUB REGISTRAR BORIVALI 6",
        "IGR196-BRL7_JT SUB REGISTRAR BORIVALI 7",
        "IGR197-KRL1_JT SUB REGISTRAR KURLA NO 1",
        "IGR198-KRL2_JT SUB REGISTRAR KURLA NO 2",
        "IGR199-KRL3_JT SUB REGISTRAR KURLA NO 3",
        "IGR200-KRL4_JT SUB REGISTRAR KURLA NO 4",
    ],
    "THANE": [
        "IGR113-THN1_HQR SUB REGISTRA THANE URBAN 1",
        "IGR114-THN2_THANE 2 JOINT SUB REGISTRAR",
        "IGR115-THN3_THANE NO 3 JOINT SUB REGISTRA",
        "IGR116-THN4_THANE NO 4 JOINT SUB REGISTRA",
        "IGR117-THN5_THANE NO 5 JOINT SUB REGISTRA",
        "IGR118-THN6_THANE NO 6 JOINT SUB REGISTRA",
        "IGR119-THN7_THANE NO 7 JOINT SUB REGISTRAR",
        "IGR121-THN9_THANE NO 9 JOINT SUB REGISTRAR",
        "IGR122-THN10_THANE NO 10 JOINT SUB REGISTR",
        "IGR123-THN11_THANE NO 11 JOINT SUB REGISTR",
        "IGR124-KLN1_KALYAN NO 1 SUB REGISTRAR",
        "IGR125-KLN2_KALYAN 2 JOINT SUB REGISTRAR",
        "IGR126-KLN3_KALYAN NO 3 JOINT SUB REGISTRA",
        "IGR127-KLN4_KALYAN 4 JOINT SUB REGISTRAR",
        "IGR128-ULH1_ULHASNAGAR NO 1 SUB REGISTRAR",
        "IGR129-ULH2_ULHASNAGAR 2 JT SUB REGISTRAR",
        "IGR131-BVD1_BHIWANDI NO 1 SUB REGISTRAR",
        "IGR132-BVD2_BHIWANDI 2 JOINT SUB REGISTRAR",
        "IGR136-MBD_MURBAD SUB REGISTRAR",
        "IGR139-SHP_SHAHAPUR SUB REGISTRAR",
        "IGR570-ULH4_ULHASNAG4 BADLAPUR JT SUB REG",
    ],
    "PUNE": [
        "IGR008-HVL1_HAVELI NO1 SUB REGISTRAR",
        "IGR009-HVL2_HAVELI 2 JOINT SUB REGISTRAR",
        "IGR010-HVL3_HAVELI 3 JOINT SUB REGISTRAR",
        "IGR011-HVL4_HAVELI 4 JOINT SUB REGISTRAR",
        "IGR012-HVL5_HAVELI 5 JOINT SUB REGISTRAR",
        "IGR030-MVL_MAWAL VADGAON SUB REGISTRAR",
        "IGR032-DND_DHAUND SUB REGISTRAR",
        "IGR033-BMT_BARAMATI SUB REGISTRAR",
        "IGR034-MLS_MULSHI 1 SUB REGISTRAR",
        "IGR035-KED_KHED 1 SUB REGISTRAR",
        "IGR036-IND_INDAPUR SUB REGISTRAR",
        "IGR037-PUR_SASWAD PURANDAR SUB REGISTRAR",
        "IGR038-BHO_BHOR SUB REGISTRAR",
        "IGR039-ABN_AMBEGAON SUB REGISTRAR",
        "IGR040-JUN_JUNNAR SUB REGISTRAR",
        "IGR041-WLA_VELHA SUB REGISTRAR",
        "IGR043-LVL_LOANAWALA SUB REGISTRAR",
        "IGR047-NRN_NARAYANGAON SUB REGISTRAR",
    ],
    "NAGPUR": [
        "IGR383-NGP1_HQR SUB REGISTRAR NAGPUR 1",
        "IGR384-NGP2_JT NAGPUR SUB REGISTRAR",
        "IGR385-NGP3_JT NAGPUR NO 3 SUB REGISTRAR",
        "IGR386-NGP4_JT NAGPUR NO 4 SUB REGISTRAR",
        "IGR387-NGP5_JT NAGPUR NO 5 SUB REGISTRAR",
        "IGR388-NGP6_JT NAGPUR NO 6 SUB REGISTRAR",
        "IGR389-NGP7_JT NAGPUR NO 7 SUB REGISTRAR",
        "IGR390-NGP8_JT NAGPUR N0 8 SUB REGISTRAR",
        "IGR391-NGP9_NAGPUR NO 9 SUB REGISTRAR",
        "IGR392-HGN_HINGNA SUB REGISTRAR",
        "IGR393-RTK_RAMTEK SUB REGISTRAR",
        "IGR397-KTL_KATOL SUB REGISTRAR",
        "IGR399-NRK_NARKHED SUB REGISTRAR",
        "IGR400-UMD_UMERD SUB REGISTRAR",
        "IGR401-SVN_SAWNER SUB REGISTRAR",
        "IGR402-KMT_KAMTHI SUB REGISTRAR",
    ],
    "NASHIK": [
        "IGR311-NSK1_HQR SUB REGISTRAR NASHIK 1",
        "IGR312-NSK2_NASHIK 2 JOINT SUB REGISTRAR",
        "IGR313-NSK3_NASHIK 3 JOINT SUB REGISTRAR",
        "IGR314-NSK4_NASHIK 4 JOINT SUB REGISTRAR",
        "IGR315-NSK5_NASHIK 5 JOINT SUB REGISTRAR",
        "IGR316-KWN_KALWAN SUB REGISTRAR",
        "IGR317-CDD_CHANDWAD SUB REGISTRAR",
        "IGR318-NDG_NANDGAON SUB REGISTRAR",
        "IGR319-NPD_NIPHAD SUB REGISTRAR",
        "IGR320-BGL_BAGLAN SUB REGISTRAR",
        "IGR321-MLG1_MALEGAON NO 1 SUB REGISTRAR",
        "IGR322-MLG2_MALEGAON 2 JOINT SUB REGISTRAR",
        "IGR324-IGT_IGATPURI SUB REGISTRAR",
        "IGR325-DDR_DINDORI SUB REGISTRAR",
        "IGR326-SNR_SINNAR SUB REGISTRAR",
        "IGR327-TBK_TRIMBAKESHWAR SUB REGISTRAR",
        "IGR329-SRG_SURGANA SUB REGISTRAR",
        "IGR330-LSL_LASALGAON SUB REGISTRAR",
    ],
}


def resolve_maharashtra_district(district: str) -> list[str]:
    """Validates a client-submitted district against this (partial) list,
    raising ValueError if unrecognized — used from a Pydantic field_validator,
    which needs ValueError specifically (see stamp_service.StampOtfInitiateRequest)."""
    offices = MAHARASHTRA_DISTRICTS.get(district.upper())
    if offices is None:
        raise ValueError(f"'{district}' is not a recognized Maharashtra district in this list.")
    return offices


# SignDesk's own Annexure 3 keys every district by a numeric-prefixed code
# ("2201-PUNE", not bare "PUNE") — confirmed from the DSS 2.0 API doc itself
# after a live ds-179 "district and sub_registrar_office values are not
# matching" error on 2026-09-03, caused by sending the bare district name.
# The bare names above (MAHARASHTRA_DISTRICTS' keys) stay as the
# user-facing dropdown label; this mapping is only for what actually gets
# sent to SignDesk as esbtr_details.district (see
# stamp_service._build_request_payload_otf).
MAHARASHTRA_DISTRICT_CODES: dict[str, str] = {
    "MUMBAI": "7101-MUMBAI",
    "THANE": "1201-THANE",
    "PUNE": "2201-PUNE",
    "NAGPUR": "4601-NAGPUR",
    "NASHIK": "5101-NASHIK",
}


def maharashtra_district_code(district: str) -> str:
    """The SignDesk-coded district string to actually send in the request —
    falls back to the bare uppercased name if somehow not in the map (should
    never happen for a district that already passed resolve_maharashtra_district)."""
    return MAHARASHTRA_DISTRICT_CODES.get(district.upper(), district.upper())
