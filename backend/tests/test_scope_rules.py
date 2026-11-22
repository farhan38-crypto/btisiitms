"""Offline (no-AI) scope rules: is a report an IT/facilities issue or not?

Two lists of real-world phrasings: things that must stay IT tickets even
though they contain alarming words, and things that must show the emergency /
non-IT guidance even though they mention computers.
"""
import pytest

from app.domain.scope import RuleBasedScopeClassifier, ScopeKind as K, parse_ai_kind, combine, ScopeAssessment

rules = RuleBasedScopeClassifier()

STAYS_IT = [
    # alarming words used as IT jargon
    'Need to kill the process, the app keeps crashing',
    'kill -9 does not stop the server',
    'My laptop battery died during the quiz',
    'Dead pixels on the monitor in lab 203',
    'Firewall is blocking the VPN connection',
    'Smoke tests failing on the CI server',
    'Python script crashed with a memory error',
    'Found a bug in the LMS assignment upload',
    'System hangs on boot after the windows update',
    'Someone stole my password and logged into my account',
    'My account was hacked and the password changed',
    'Phishing email asking students for their OTP',
    'DDoS attack on the campus website',
    'This assignment portal is killing me, it will not load',
    'The screen is black after login',
    'Health check endpoint failing on the ERP server',
    'Collapsed sidebar menu will not expand on Moodle',
    'Apache Spark job failing on the GPU cluster',
    'Python monkey patch broke the tests',
    'Email blast to all students failed to send',
    'Security patch update failed on lab PCs',
    'Virus detected on the library computer',
    'Medical Centre printer is not working',
    'Fire TV stick will not connect to the hostel wifi',
    'I accidentally deleted my files from the shared drive',
    'Faint buzzing sound from the projector speaker',
    'I was shocked to see my grades missing on the ERP portal',
    'The charger fits loosely in the socket',
    # facilities = in scope (carpenter/electrician/technician)
    'Fan not working in my room 204',
    'Tube light flickering in the corridor',
    'Bed frame is broken in Krishna Bhavan',
    'Power socket not working near my desk',
    'Water cooler not cooling on the second floor',
    # non-English / informal IT
    'wifi nahi chal raha hostel me',
    'wifi ded pls fix 😭😭',
    # academics/admin but through IT systems → IT
    "Can't see my marks on the ERP portal",
    'Fee payment page shows error 500',
    'Mess menu website is down',
    'Attendance not updating in the LMS',
    # empty / gibberish → default IT, never block
    '', 'asdkjh qwe zxcmn', '!!!!!!', '12345',
]

NOT_IT = [
    ('My friend Farhan is suicidal, please help', K.MENTAL_HEALTH),
    ('A report has been received indicating a potential suicide involving a student', K.MENTAL_HEALTH),
    ('I want to end my life', K.MENTAL_HEALTH),
    ('my roommate said he wants to kill himself', K.MENTAL_HEALTH),
    ('She has been self-harming and I am scared', K.MENTAL_HEALTH),
    ('SUICIDE', K.MENTAL_HEALTH),
    ('s u i c i d e', K.MENTAL_HEALTH),
    ('su1c1de thoughts', K.MENTAL_HEALTH),
    ('he is threatening to jump off the terrace', K.MENTAL_HEALTH),
    ('I took an overdose of pills', K.MENTAL_HEALTH),
    ('i dont want to live anymore', K.MENTAL_HEALTH),
    ('मेरा दोस्त आत्महत्या करने की बात कर रहा है', K.MENTAL_HEALTH),
    ('నా స్నేహితుడు ఆత్మహత్య గురించి మాట్లాడుతున్నాడు', K.MENTAL_HEALTH),
    ('i want to die lol the wifi is down', K.MENTAL_HEALTH),   # hyperbole → still show help (one click to continue)
    ('A student fainted in the LTC computer lab', K.MEDICAL),
    ('My friend has chest pain and difficulty breathing', K.MEDICAL),
    ('Someone is unconscious near the library', K.MEDICAL),
    ('Need an ambulance at Gautam Bhavan', K.MEDICAL),
    ('Student had a seizure during the exam', K.MEDICAL),
    ('My roommate has high fever and is vomiting', K.MEDICAL),
    ('Got a dog bite near the mess', K.MEDICAL),
    ('My laptop charger caught fire', K.FIRE),
    ('Smoke coming out of the projector in NAB', K.FIRE),
    ('There is a burning smell from the server room', K.FIRE),
    ('Gas leak in the mess kitchen', K.FIRE),
    ('Fire in the hostel corridor', K.FIRE),
    ('Sparks coming from the socket in my room', K.ELECTRICAL),
    ('I got an electric shock from the switch board', K.ELECTRICAL),
    ('Exposed wires hanging in the bathroom', K.ELECTRICAL),
    ('Short circuit in the lab', K.ELECTRICAL),
    ('My bicycle was stolen from the parking', K.SECURITY),
    ('My laptop was stolen from the library', K.SECURITY),
    ('Someone is harassing me on the way to the hostel', K.SECURITY),
    ('There was a fight outside the mess', K.SECURITY),
    ('Stranger is following me near Block C', K.SECURITY),
    ('There is a snake in the corridor', K.PEST),
    ('Snake spotted in the computer lab', K.PEST),
    ('Monkeys entered my room and took my food', K.PEST),
    ('Beehive near the window of room 112', K.PEST),
    ('Mess food is terrible today', K.OTHER),
    ('My grades are wrong in the transcript office records', K.OTHER),
    ('Need a fee refund for last semester', K.OTHER),
    ('I lost my ID card', K.OTHER),
    ('Room allotment request for next semester', K.OTHER),
]


@pytest.mark.parametrize('text', STAYS_IT)
def test_it_reports_are_never_blocked(text):
    r = rules.assess(text, text)
    assert r.in_scope, f'{text!r} was wrongly flagged as {r.kind.value} (matched {r.matched})'


@pytest.mark.parametrize('text,kind', NOT_IT)
def test_non_it_reports_are_detected(text, kind):
    r = rules.assess('', text)
    assert not r.in_scope and r.kind == kind, f'{text!r} → {r.kind.value} (matched {r.matched})'
    assert r.title and r.message and r.contacts


def test_title_alone_is_enough():
    assert rules.assess('Student collapsed in lab', 'please send help').kind == K.MEDICAL


def test_life_safety_beats_it_words_and_other_categories():
    assert rules.assess('Laptop', 'my laptop is on fire and someone got hurt, injured badly').kind == K.MEDICAL
    assert rules.assess('Wi-Fi', 'wifi is down and my friend is suicidal').kind == K.MENTAL_HEALTH


def test_contacts_include_the_campus_numbers():
    numbers = lambda kind: {c['number'] for c in ScopeAssessment.for_kind(kind, 'rules').contacts}
    assert {'14416', '9640921921', '9010202850'} <= numbers(K.MENTAL_HEALTH)
    assert '9912316753' in numbers(K.ELECTRICAL)
    assert '8106866196' in numbers(K.PEST)
    assert '9010202883' in numbers(K.SECURITY)
    assert ScopeAssessment.for_kind(K.MEDICAL, 'rules').emergency
    assert not ScopeAssessment.for_kind(K.OTHER, 'rules').emergency


def test_very_long_input_is_handled():
    assert rules.assess('x', 'wifi slow ' * 3000).in_scope
    assert rules.assess('x', 'wifi slow ' * 3000 + ' snake in room').kind == K.PEST


@pytest.mark.parametrize('raw,kind', [
    ('it', K.IT), ('IT', K.IT), ('facilities', K.FACILITIES), ('mental_health_crisis', K.MENTAL_HEALTH),
    ('Mental Health', K.MENTAL_HEALTH), ('medical emergency', K.MEDICAL), ('pest-animal', K.PEST),
    ('other', K.OTHER), ('banana', None), (None, None), (42, None), ('', None),
])
def test_ai_answers_are_parsed_safely(raw, kind):
    assert parse_ai_kind(raw) == kind


def test_combining_ai_and_rules_is_safety_first():
    crisis = rules.assess('', 'my friend is suicidal')
    assert combine(crisis, K.IT).kind == K.MENTAL_HEALTH             # AI can't wave away a crisis
    assert combine(crisis, K.MENTAL_HEALTH).source == 'ai+rules'
    calm = rules.assess('', 'my friend seems very low and hopeless lately')
    assert combine(calm, K.MENTAL_HEALTH).kind == K.MENTAL_HEALTH    # AI catches what keywords miss
    assert combine(calm, None).in_scope                              # no AI → rules decide
    mess = rules.assess('', 'Mess food is terrible')
    assert combine(mess, K.IT).in_scope                              # AI may correct a non-safety rule
    assert combine(rules.assess('', 'wifi down'), K.OTHER).kind == K.OTHER
