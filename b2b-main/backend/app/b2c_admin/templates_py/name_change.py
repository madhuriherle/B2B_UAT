from jinja2 import Template


def val(x):
    """Helper function to display value or placeholder if empty"""
    return x if x not in [None, "", [], {}] else "          "


def render_template(data):
    """Render name change deed template"""

    template_str = """
    <div style="padding:36px 48px; font-family: Georgia, 'Times New Roman', serif; color:#222;">

        <!-- TITLE -->
        <div style="text-align:center; margin-bottom:28px;">
            <div style="font-size:20px; font-weight:700;">
                Affidavit for Change of Name
            </div>
        </div>

        <!-- CONTENT -->
        <div style="line-height:1.8; font-size:14px;">

            <p>
                I, <strong style="border-bottom:1.5px solid #222;">{{ val(data.get('old_name')) }}</strong>,
                <strong style="border-bottom:1.5px solid #222;">{{ val(data.get('gender')) }}</strong>,
                aged <strong style="border-bottom:1.5px solid #222;">{{ val(data.get('age')) }}</strong> years,
                S/o <strong style="border-bottom:1.5px solid #222;">{{ val(data.get('guardian_name')) }}</strong>,
                residing at <strong style="border-bottom:1.5px solid #222;">{{ val(data.get('address')) }}</strong>,
                India, do hereby solemnly affirm and declare as under:
            </p>

            <ol style="margin-top:20px; padding-left:20px;">
                <li style="margin-bottom:12px;">
                    That my name earlier was <strong style="border-bottom:1.5px solid #222;">{{ val(data.get('old_name')) }}</strong>
                    as recorded in my <strong style="border-bottom:1.5px solid #222;">{{ val(data.get('document_name')) }}</strong>.
                </li>
                <li style="margin-bottom:12px;">
                    All the records shall have my new name hereafter.
                </li>
                <li style="margin-bottom:12px;">
                    That I have changed my name to <strong style="border-bottom:1.5px solid #222;">{{ val(data.get('new_name')) }}</strong>
                    on/from <strong style="border-bottom:1.5px solid #222;">{{ val(data.get('date')) }}</strong>.
                </li>
                <li style="margin-bottom:12px;">
                    Reason for name change: <strong style="border-bottom:1.5px solid #222;">{{ val(data.get('reason')) }}</strong>
                </li>
                <li style="margin-bottom:12px;">
                    I state that <strong style="border-bottom:1.5px solid #222;">{{ val(data.get('old_name')) }}</strong>
                    and <strong style="border-bottom:1.5px solid #222;">{{ val(data.get('new_name')) }}</strong>
                    are the names of one and the same person and that is myself.
                </li>
            </ol>

            <p style="margin-top:20px;">
                I am executing this declaration to be submitted to the concerned authorities for the change of name.
            </p>

            <!-- VERIFICATION -->
            <div style="margin-top:48px;">
                <div style="text-align:center; font-size:16px; font-weight:700; margin-bottom:16px;">Verification</div>
                <p>
                    Verified at <span style="border-bottom:1px solid #222;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
                    on <span style="border-bottom:1px solid #222;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
                    that the above contents of this affidavit are true and correct to the best of my knowledge and belief and nothing has been concealed therein.
                </p>
            </div>

            <!-- DEPONENT -->
            <div style="text-align:right; margin-top:32px;">
                Deponent
            </div>

            <!-- NOTARY LINE -->
            <div style="text-align:center; margin-top:32px;">
                Attested by Notary/ Advocate S.E.M./ Oaths Commissioner
            </div>

            <!-- SOLEMNLY AFFIRMED -->
            <p style="margin-top:24px;">
                Solemnly affirmed at <span style="border-bottom:1px solid #222;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
                on this <span style="border-bottom:1px solid #222;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> day of <span style="border-bottom:1px solid #222;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
            </p>

            <!-- BOTTOM SIGNATURE BLOCK -->
            <div style="margin-top:48px; display:flex; justify-content:space-between;">
                <div>
                    <p>Identified by me, Before me</p>
                    <p style="margin-top:32px;">Advocate S.E.M./Oaths Commissioner/Notary</p>
                </div>
                <div style="text-align:right;">
                    <p>X<span style="border-bottom:1px solid #222;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></p>
                    <p style="margin-top:32px;">Signature of the Deponent</p>
                </div>
            </div>

        </div>
    </div>
    """

    t = Template(template_str)
    return t.render(data=data, val=val)
