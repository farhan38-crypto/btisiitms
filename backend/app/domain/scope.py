"""Is this report something the IT/facilities help desk can handle?

Reports about medical emergencies, mental-health crises, fire, electrical
danger, security incidents or animals on campus must not become IT tickets.
The student needs the right people immediately, so the app shows them who to
contact instead.

Two layers decide (Strategy-style, both behind `assess`):
  • RuleBasedScopeClassifier: deterministic keyword rules, always available
    (the demo may have no AI access).
  • the AI classifier (Gemini), when configured.
Safety rule: if the rules detect a possible life-safety situation, the
emergency guidance is shown even when the AI disagrees. A false alarm costs the
student one click ("It is an IT issue — continue"); a missed emergency could
cost much more.

Campus numbers are from the BITS Pilani Hyderabad "Safety of Student" slide.
Update CAMPUS_CONTACTS if they change.
"""
import re
import unicodedata
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional


@dataclass(frozen=True)
class Contact:
    label: str
    number: str
    note: str = ''


CAMPUS_CONTACTS = {
    'medical': Contact('Medical Center (campus)', '9010202850'),
    'ambulance': Contact('Ambulance (campus)', '9640921921'),
    'security': Contact('Fire and Security (campus)', '9010202883'),
    'security_landline': Contact('Fire and Security (campus landline)', '040 66663988'),
    'electrical': Contact('Electrical Emergency (campus)', '9912316753'),
    'pest': Contact('Pest Control / Snake Catchers (campus)', '8106866196'),
}
NATIONAL_CONTACTS = {
    'emergency': Contact('National emergency number', '112', 'Police, fire and ambulance'),
    'ambulance': Contact('Ambulance (national)', '108'),
    'tele_manas': Contact('Tele-MANAS mental health helpline', '14416', 'Free, confidential, 24×7, many languages'),
}


class ScopeKind(str, Enum):
    IT = 'it'
    FACILITIES = 'facilities'
    MENTAL_HEALTH = 'mental_health_crisis'
    MEDICAL = 'medical_emergency'
    FIRE = 'fire'
    ELECTRICAL = 'electrical_emergency'
    SECURITY = 'security'
    PEST = 'pest_animal'
    OTHER = 'other_non_it'


IN_SCOPE = {ScopeKind.IT, ScopeKind.FACILITIES}
LIFE_SAFETY = {ScopeKind.MENTAL_HEALTH, ScopeKind.MEDICAL, ScopeKind.FIRE, ScopeKind.ELECTRICAL}

C, N = CAMPUS_CONTACTS, NATIONAL_CONTACTS
GUIDANCE = {
    ScopeKind.MENTAL_HEALTH: dict(
        title='Please reach out for help right now',
        message=('If you or someone you know is thinking about suicide or self-harm, or might be in danger, '
                 'please call for help now. Stay with the person if you can. You do not have to handle this alone. '
                 'The IT help desk cannot respond to this, but the people below can, any time of day.'),
        contacts=[N['tele_manas'], C['ambulance'], C['medical'], C['security'], N['emergency']], emergency=True),
    ScopeKind.MEDICAL: dict(
        title='This sounds like a medical emergency',
        message='Call the campus ambulance or Medical Center now. The IT help desk cannot respond to medical issues.',
        contacts=[C['ambulance'], C['medical'], N['ambulance'], N['emergency']], emergency=True),
    ScopeKind.FIRE: dict(
        title='Possible fire or gas danger',
        message=('Move away from the danger and call Fire and Security now. Do not try to fix it yourself. '
                 'If a device is overheating or burning, unplug it only if that is safe.'),
        contacts=[C['security'], C['security_landline'], N['emergency']], emergency=True),
    ScopeKind.ELECTRICAL: dict(
        title='Electrical danger: call the electrical emergency line',
        message=('Stay away from the sparking or exposed wiring and do not touch anyone who is still in contact with '
                 'it. If someone was shocked, call the ambulance too.'),
        contacts=[C['electrical'], C['ambulance'], C['security'], N['emergency']], emergency=True),
    ScopeKind.SECURITY: dict(
        title='This is a campus security matter',
        message=('For theft, harassment, threats, fights or anyone unsafe on campus, contact Fire and Security. '
                 'If someone is in immediate danger, call 112.'),
        contacts=[C['security'], C['security_landline'], N['emergency']], emergency=False),
    ScopeKind.PEST: dict(
        title='Animals and pests are handled by Pest Control',
        message='Keep a safe distance (especially from snakes) and call Pest Control / Snake Catchers. '
                'If someone was bitten or stung, call the ambulance.',
        contacts=[C['pest'], C['ambulance'], C['security']], emergency=False),
    ScopeKind.OTHER: dict(
        title='This does not look like an IT or facilities issue',
        message=('BITS reports handles IT problems (Wi-Fi, accounts, portals, lab computers, projectors) and room '
                 'repairs (carpenter, electrician, technician). For mess, fees, academics, lost items or hostel '
                 'administration, please contact the Student Welfare Division (SWD) or the office responsible.'),
        contacts=[C['security']], emergency=False),
}


@dataclass
class ScopeAssessment:
    in_scope: bool
    kind: ScopeKind
    source: str                       # 'rules', 'ai', or 'ai+rules'
    matched: list = field(default_factory=list)
    title: str = ''
    message: str = ''
    contacts: list = field(default_factory=list)
    emergency: bool = False

    @classmethod
    def for_kind(cls, kind: ScopeKind, source: str, matched=None):
        if kind in IN_SCOPE:
            return cls(True, kind, source, matched or [])
        g = GUIDANCE[kind]
        return cls(False, kind, source, matched or [], g['title'], g['message'], [asdict(c) for c in g['contacts']],
                   g['emergency'])

    def to_dict(self):
        d = asdict(self)
        d['kind'] = self.kind.value
        return d


# ───────────────────────────── rules ─────────────────────────────

def normalise(text: str) -> str:
    text = unicodedata.normalize('NFKC', text or '').lower()
    text = text.replace('’', "'").replace('‘', "'")
    return re.sub(r'\s+', ' ', text).strip()


def _deleet(text: str) -> str:
    """'su1c1de' → 'suicide', 's u i c i d e' → 'suicide' (only used for crisis terms)."""
    t = text.translate(str.maketrans({'1': 'i', '!': 'i', '3': 'e', '0': 'o', '4': 'a', '@': 'a', '$': 's', '5': 's'}))
    return re.sub(r'[^a-zऀ-ॿఀ-౿]', '', t)


W = r'(?<![a-z])'     # word start
E = r'(?![a-z])'      # word end


def rx(*patterns):
    return [re.compile(p) for p in patterns]


# Phrases that look alarming but are everyday IT language → removed before matching.
IT_IDIOMS = rx(
    rf'{W}kill(?:ed|ing|s)? (?:the |a |that |this )?(?:process|task|app|program|session|job|server|tab|port)s?{E}',
    rf'{W}kill -\d+', rf'{W}(?:task|process) ?kill', rf'{W}killall{E}',
    rf'{W}dead ?(?:pixel|link|lock|key|code|zone|battery)s?{E}', rf'{W}(?:battery|charger|phone|laptop|mouse|keyboard|disk|drive|server|app|process|port|link) (?:is |has |just )?died{E}',
    rf'{W}smoke ?tests?{E}', rf'{W}fire ?wall', rf'{W}fire ?(?:tv|stick|fox|base|store)', rf'{W}fire (?:up|off) (?:the |a )?(?:server|app|script|email|request|query|vm|instance)',
    rf'{W}(?:ddos|dos|cyber|phishing|brute[- ]force|man[- ]in[- ]the[- ]middle|replay|xss|sql injection) attacks?{E}',
    rf'{W}(?:stolen|steal|stole|theft of) (?:my |the |our )?(?:password|account|credential|login|identity|data|session|cookie|token|otp|email|wifi)s?{E}',
    rf'{W}(?:password|account|credential|data|identity|login|otp|session|token)s? (?:was |were |got |been )?(?:stolen|hacked|leaked){E}',
    rf'{W}(?:health ?check|heart ?beat|heartbeat)s?{E}', rf'{W}collaps(?:ed|ible|e) (?:menu|sidebar|section|panel|list|view|tab)s?{E}',
    rf'{W}(?:system|computer|laptop|pc|app|screen|browser|phone|it) (?:keeps? )?hang(?:s|ing)?{E}', rf'{W}hang(?:s|ing)? on (?:boot|startup|login|loading){E}',
    rf'{W}python{E}(?! snake)', rf'{W}(?:software|code|app|website|portal) bugs?{E}', rf'{W}bugs? (?:in|on) (?:the )?(?:app|code|portal|website|lms|erp|software|system){E}',
    rf'{W}(?:security|safety) (?:patch|update|certificate|setting|key|question|scan|alert|warning)s?{E}',
    rf'{W}(?:virus|malware|trojan|worm|ransomware){E}', rf'{W}medical (?:cent(?:er|re)|centre)\'?s? (?:printer|computer|pc|wifi|wi-fi|system|network|projector|portal|software)',
    rf'{W}(?:this|it|the [a-z]+|wifi|portal|assignment|lag) (?:is )?killing me{E}',
    rf'{W}(?:screen|monitor|display) (?:is )?(?:black|dead|frozen){E}',
    rf'{W}apache spark{E}', rf'{W}spark (?:job|cluster|session|sql|shell|context)s?{E}', rf'{W}monkey ?patch',
    rf'{W}(?:email|mail|sms|whatsapp) blast{E}', rf'{W}blast (?:email|mail|message)s?{E}',
)

RULES = {
    ScopeKind.MENTAL_HEALTH: rx(
        rf'{W}suicid', rf'{W}kill(?:ing)? (?:my|him|her|them)sel(?:f|ves){E}', rf'{W}end (?:my|his|her|their) (?:own )?li(?:fe|ves){E}',
        rf'{W}take (?:my|his|her|their) (?:own )?li(?:fe|ves){E}', rf'{W}self[- ]?harm', rf'{W}(?:cut|cutting|hurt|hurting|harm|harming) (?:my|him|her|them)sel(?:f|ves){E}',
        rf'{W}hang(?:ing)? (?:my|him|her|them)sel(?:f|ves){E}', rf'{W}want(?:s|ed)? to die{E}', rf'{W}(?:do ?n[o\']?t|does ?n[o\']?t) want to live{E}',
        rf'{W}no (?:reason|point) (?:to|in) liv', rf'{W}jump(?:ing|ed)? (?:off|from) (?:the |a )?(?:roof|terrace|building|bridge|balcony|floor)',
        rf'{W}overdos', rf'{W}(?:khudkushi|aatmahatya|atmahatya)', 'आत्महत्या', 'ఆత్మహత్య', 'खुदकुशी',
    ),
    ScopeKind.MEDICAL: rx(
        rf'{W}ambulance', rf'{W}unconscious{E}', rf'{W}faint(?:ed|ing){E}', rf'{W}pass(?:ed)? out{E}', rf'{W}(?:not|isn\'?t|stopped) breathing{E}',
        rf'{W}can\'?t breathe{E}', rf'{W}(?:difficulty|trouble) breathing{E}', rf'{W}heart attack{E}', rf'{W}chest pain{E}',
        rf'{W}seizures?{E}', rf'{W}bleeding{E}', rf'{W}(?:broken|fractured) (?:arm|leg|bone|hand|wrist|ankle)',
        rf'{W}fracture', rf'{W}injur(?:ed|y|ies){E}', rf'{W}allergic reaction{E}', rf'{W}anaphyla', rf'{W}(?:high )?fever{E}',
        rf'{W}vomit', rf'{W}food poisoning{E}', rf'{W}collapsed{E}', rf'{W}medical emergency{E}', rf'{W}(?:snake|dog|monkey) ?bite',
        rf'{W}stung by', rf'{W}accident{E}', rf'{W}(?:need|call|get) (?:a )?doctor{E}', rf'{W}asthma attack{E}',
    ),
    ScopeKind.FIRE: rx(
        rf'{W}fire{E}', rf'{W}on fire{E}', rf'{W}caught fire{E}', rf'{W}flames?{E}', rf'{W}smoke{E}', rf'{W}smoking (?:charger|laptop|socket|wire|device|plug)',
        rf'{W}burning (?:smell|wire|plastic){E}', rf'{W}smell(?:s|ing)? (?:of )?(?:burning|smoke|gas){E}', rf'{W}gas (?:leak|smell){E}',
        rf'{W}explo(?:sion|ded|de){E}', rf'{W}blast{E}',
    ),
    ScopeKind.ELECTRICAL: rx(
        rf'{W}electric(?:al)? shock', rf'{W}(?:got|get|getting|gave|giving|felt) (?:a |an )?(?:electric |small |big )?shock(?:ed)?{E}',
        rf'{W}shock(?:ed)? (?:from|by|when touching) (?:the |a )?(?:socket|switch|plug|wire|appliance|geyser|cooler|fan|ac|board|tap)',
        rf'{W}shocked (?:me|him|her){E}', rf'{W}electrocut', rf'{W}spark(?:s|ing|ed)?{E}', rf'{W}short ?circuit',
        rf'{W}(?:live|exposed|naked|open|hanging) wir(?:e|es|ing){E}', rf'{W}transformer (?:blast|burst|fire)',
    ),
    ScopeKind.SECURITY: rx(
        rf'{W}stolen{E}', rf'{W}(?:theft|thief|thieves|robbery|robbed|burglar)', rf'{W}harass', rf'{W}assault', rf'{W}molest',
        rf'{W}stalk(?:ing|ed|er)?{E}', rf'{W}(?:fight|fighting|beaten|beat (?:me|him|her|up))\b', rf'{W}physically attacked{E}',
        rf'{W}attacked (?:me|him|her|us|them){E}', rf'{W}threaten', rf'{W}intruder', rf'{W}trespass', rf'{W}ragging{E}',
        rf'{W}weapon', rf'{W}knife{E}', rf'{W}(?:feel|feeling|am|is) unsafe{E}', rf'{W}(?:someone|somebody|a stranger|stranger|a man|a guy|some guy|people) (?:is |are |keeps |has been )?(?:following|stalking|watching) (?:me|her|him|us)',
        rf'{W}missing (?:student|person|friend|roommate){E}', rf'{W}(?:drunk|drugs) ', rf'{W}lost my (?:wallet|bag|phone|bike|cycle)',
    ),
    ScopeKind.PEST: rx(
        rf'{W}snakes?{E}', rf'{W}cobra', rf'{W}python snake', rf'{W}scorpions?{E}', rf'{W}rats?{E}', rf'{W}mice{E}',
        rf'{W}monkeys?{E}', rf'{W}(?:bees|beehive|wasps?|hornets?){E}', rf'{W}termites?{E}', rf'{W}cockroach', rf'{W}stray dogs?{E}',
        rf'{W}(?:bed ?bugs|mosquito(?:es)? breeding){E}', rf'{W}pest control{E}',
    ),
    ScopeKind.OTHER: rx(
        rf'{W}mess (?:food|menu|bill|timing|fee)', rf'{W}food (?:quality|is (?:bad|terrible|stale|cold))', rf'{W}(?:grades?|marks|cgpa|attendance) (?:are|is) (?:wrong|incorrect|low)',
        rf'{W}fee (?:refund|waiver|concession){E}', rf'{W}scholarship{E}', rf'{W}room (?:allotment|change|swap){E}', rf'{W}roommate (?:issue|problem|dispute|fight)',
        rf'{W}out ?pass{E}', rf'{W}leave (?:application|request){E}', rf'{W}lost (?:my )?(?:id|identity) card{E}', rf'{W}laundry{E}',
        rf'{W}lost and found{E}', rf'{W}bonafide certificate{E}', rf'{W}timetable clash{E}',
    ),
}

# Words that show the report is about IT/facilities; they lower the confidence of
# non-emergency "out of scope" matches (e.g. "can't see my marks on the ERP portal").
IT_SIGNALS = re.compile(
    rf'{W}(?:wi-?fi|internet|network|lan|ethernet|router|vpn|dns|portal|website|web ?site|erp|lms|moodle|cms|login|log in|'
    rf'password|otp|sso|account|email|e-mail|outlook|app|software|server|laptop|computer|pc|desktop|printer|projector|'
    rf'monitor|screen|keyboard|mouse|charger|phone|error|page|system|database|install|update|bluetooth|hdmi|speaker|'
    rf'socket|switch|fan|light|ac|bulb|tube ?light|geyser|door|window|bed|table|chair|cupboard|tap)s?{E}')

PRIORITY = [ScopeKind.MENTAL_HEALTH, ScopeKind.MEDICAL, ScopeKind.FIRE, ScopeKind.ELECTRICAL, ScopeKind.SECURITY,
            ScopeKind.PEST, ScopeKind.OTHER]


class RuleBasedScopeClassifier:
    """Deterministic, offline scope check (no AI needed)."""

    def assess(self, title: str, description: str) -> ScopeAssessment:
        text = normalise(f'{title or ""} . {description or ""}')
        cleaned = text
        for idiom in IT_IDIOMS:
            cleaned = idiom.sub(' ', cleaned)
        it_context = bool(IT_SIGNALS.search(cleaned))
        compact = _deleet(cleaned)
        for kind in PRIORITY:
            hits = [m.group(0).strip() for p in RULES[kind] for m in [p.search(cleaned)] if m]
            if kind == ScopeKind.MENTAL_HEALTH and not hits:
                hits = [w for w in ('suicid', 'selfharm') if w in compact]
            if not hits:
                continue
            if kind in LIFE_SAFETY:
                return ScopeAssessment.for_kind(kind, 'rules', hits)
            if kind in (ScopeKind.SECURITY, ScopeKind.PEST):
                # Cyber phrasing ("stolen password", "python") was removed above, so what is left is physical.
                return ScopeAssessment.for_kind(kind, 'rules', hits)
            if kind == ScopeKind.OTHER and not it_context:
                return ScopeAssessment.for_kind(kind, 'rules', hits)
        return ScopeAssessment.for_kind(ScopeKind.IT, 'rules')


def parse_ai_kind(value) -> Optional[ScopeKind]:
    """Map whatever the AI said to a ScopeKind; None if unusable."""
    v = normalise(str(value or '')).replace(' ', '_').replace('-', '_')
    aliases = {'it': ScopeKind.IT, 'it_issue': ScopeKind.IT, 'facilities': ScopeKind.FACILITIES, 'facility': ScopeKind.FACILITIES,
               'mental_health': ScopeKind.MENTAL_HEALTH, 'suicide': ScopeKind.MENTAL_HEALTH, 'medical': ScopeKind.MEDICAL,
               'fire_or_gas': ScopeKind.FIRE, 'electrical': ScopeKind.ELECTRICAL, 'animal': ScopeKind.PEST, 'pest': ScopeKind.PEST,
               'other': ScopeKind.OTHER, 'non_it': ScopeKind.OTHER}
    try:
        return ScopeKind(v)
    except ValueError:
        return aliases.get(v)


def combine(rules: ScopeAssessment, ai_kind: Optional[ScopeKind]) -> ScopeAssessment:
    """Merge the AI's opinion with the rules, safety first."""
    if rules.kind in LIFE_SAFETY:
        return ScopeAssessment.for_kind(rules.kind, 'ai+rules' if ai_kind == rules.kind else 'rules', rules.matched)
    if ai_kind is None:
        return rules
    return ScopeAssessment.for_kind(ai_kind, 'ai', rules.matched if ai_kind == rules.kind else [])
