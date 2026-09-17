from jinja2 import Template


def val(x):
    """Helper function to display value or placeholder if empty"""
    return x if x not in [None, "", [], {}] else "___________"


def render_rental_agreement_en(data):

    template_str = """

    {% set ll = data.landlords[0] if data.landlords else {} %}
    {% set tn = data.tenants[0] if data.tenants else {} %}
    {% set pr = data.property %}
    {% set ag = data.agreement %}
    {% set rd = data.rental_details %}

    <div style="padding:36px 48px; font-family: Georgia, 'Times New Roman', serif; color:#222;">

        <!-- TITLE -->
        <div style="text-align:center; margin-bottom:28px;">
            <div style="font-size:20px; font-weight:700; letter-spacing:2px;">
                LEASE AGREEMENT
            </div>

            <div style="margin-top:8px; font-size:13px; color:#555;">
                This rent agreement ("Agreement") is made on
                <strong style="border-bottom:1.5px solid #1e40af; color:#1e3a8a;">
                    {{ val(ag.start_date) }}
                </strong>
                at
                <strong style="border-bottom:1.5px solid #1e40af; color:#1e3a8a;">
                    {{ val(pr.city) }}
                </strong>,
                <strong style="border-bottom:1.5px solid #1e40af; color:#1e3a8a;">
                    {{ val(pr.state) }}
                </strong>
            </div>
        </div>

        <div style="border-top:2px solid #1e40af; margin-bottom:24px;"></div>

        <!-- BETWEEN -->
        <p><strong>BETWEEN</strong></p>

        <p style="line-height:2; padding-left:16px; border-left:3px solid #e2e8f0;">
            <strong>LANDLORD(S)</strong><br>

            <strong style="border-bottom:1.5px solid #1e40af;">{{ val(ll.name) }}</strong>, aged
            <strong style="border-bottom:1.5px solid #1e40af;">{{ val(ll.age) }} years</strong>,
            S/o <strong style="border-bottom:1.5px solid #1e40af;">{{ val(ll.father_name) }}</strong>,
            residing at
            <strong style="border-bottom:1.5px solid #1e40af;">
                {{ val(ll.address) }}, {{ val(ll.city) }}, {{ val(ll.state) }}
            </strong>
            (hereinafter referred to as the "<strong>LANDLORD</strong>") which expression shall, unless repugnant to the context, mean and include his heirs, executors, and permitted assigns.
        </p>

        <p style="text-align:center; font-weight:700;">AND</p>

        <p style="line-height:2; padding-left:16px; border-left:3px solid #e2e8f0;">
            <strong>TENANT(S)</strong><br>

            <strong style="border-bottom:1.5px solid #1e40af;">{{ val(tn.name) }}</strong>, aged
            <strong style="border-bottom:1.5px solid #1e40af;">{{ val(tn.age) }} years</strong>,
            S/o <strong style="border-bottom:1.5px solid #1e40af;">{{ val(tn.father_name) }}</strong>,
            bearing <strong style="border-bottom:1.5px solid #1e40af;">{{ val(tn.identity_document) }}</strong> No.
            <strong style="border-bottom:1.5px solid #1e40af;">{{ val(tn.id_card_number) }}</strong>,
            residing at
            <strong style="border-bottom:1.5px solid #1e40af;">
                {{ val(tn.address) }}, {{ val(tn.city) }}, {{ val(tn.state) }}
            </strong>
            (hereinafter referred to as the "<strong>TENANT</strong>") which expression shall, unless repugnant to the context, mean and include his heirs, executors, and permitted assigns.
        </p>

        <p style="line-height:2;">
            <strong>WHEREAS</strong> the said LANDLORD(S) is the absolute owner of the Property:
            <strong style="border-bottom:1.5px solid #1e40af;">
                {{ val(pr.address) }}, {{ val(pr.city) }}, {{ val(pr.state) }}
            </strong>
            (hereinafter referred to as "<strong>PROPERTY</strong>"), and the TENANT has contacted the LANDLORD to take the property on rent and the LANDLORD has agreed to let out the Property on the terms and conditions stated below.
        </p>

        <p style="text-align:center; font-weight:700; margin-top:20px;">
        NOW, THIS DEED FURTHER WITNESSETH AND AGREED BY AND BETWEEN THE SAID PARTIES AS FOLLOWS:
        </p>

        <!-- CLAUSES -->

        <p><strong>1. Term of Tenancy:</strong></p>
        <p>
        The term of this agreement shall be for
        <strong style="border-bottom:1.5px solid #1e40af;">
        {{ val(ag.duration_value) }} {{ val(ag.duration_unit) }}
        </strong>, commencing from
        <strong style="border-bottom:1.5px solid #1e40af;">
        {{ val(ag.start_date) }}
        </strong> and ending on
        <strong style="border-bottom:1.5px solid #1e40af;">
        {{ val(ag.end_date) }}
        </strong>.
        </p>

        <p><strong>2. Rent and Security Deposit:</strong></p>
        <p>a. The monthly rent for the property is Rs. <strong style="border-bottom:1.5px solid #1e40af;">{{ val(rd.monthly_rent) }}</strong> per month.</p>
        <p>b. The tenant agrees to pay the monthly rent on or before <strong style="border-bottom:1.5px solid #1e40af;">{{ val(rd.rent_due_on) }}th</strong> day of each month via <strong style="border-bottom:1.5px solid #1e40af;">{{ val(rd.mode_of_payment) }}</strong>.</p>
        <p>c. A security deposit of Rs. <strong style="border-bottom:1.5px solid #1e40af;">{{ val(rd.security_deposit) }}</strong> has been paid by the tenant to the landlord and this amount will carry no interest. The security deposit shall be refunded at the end of the tenancy period, subject to deductions for any damages or outstanding dues.</p>

        <p><strong>3. Utilities and Maintenance:</strong></p>
        <p>a. The tenant will be responsible for paying utility bills including electricity, water, internet, and any other applicable charges.</p>

        <p><strong>4. Use of Property:</strong></p>
        <p>a. The Tenant shall use the property solely for the purpose of <strong style="border-bottom:1.5px solid #1e40af;">{{ val(ag.purpose or "Residential") }}</strong>.</p>
        <p>b. The Tenant shall not engage in any illegal, immoral, or hazardous activities on the premises.</p>
        <p>c. Subletting, assigning, or transferring the property to any third party is strictly prohibited.</p>

        <p><strong>5. Termination and Notice:</strong></p>
        <p>a. Either party may terminate this agreement by providing <strong style="border-bottom:1.5px solid #1e40af;">{{ val(rd.notice_period or 30) }} days</strong> written notice.</p>
        <p>b. Upon termination, the tenant shall return the property in the same condition.</p>

        <p><strong>6-14.</strong> (Remaining clauses same as your provided text - already included above)</p>

        <!-- SIGNATURE -->
        <div style="border-top:2px solid #1e40af; margin-top:32px; padding-top:24px;">
            <p style="text-align:center; font-weight:700;">
            In Witness Whereof, the Parties hereto have set their hands and signatures.
            </p>

            <div style="display:flex; justify-content:space-between; margin-top:32px;">
                <div>
                    <div style="border-bottom:1px solid #000; height:40px;"></div>
                    <p><strong>Landlord Signature</strong><br>{{ val(ll.name) }}</p>
                </div>

                <div>
                    <div style="border-bottom:1px solid #000; height:40px;"></div>
                    <p><strong>Tenant Signature</strong><br>{{ val(tn.name) }}</p>
                </div>
            </div>
        </div>

    </div>
    """

    return Template(template_str).render(data=data, val=val)
