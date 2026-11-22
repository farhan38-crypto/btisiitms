from fastapi import APIRouter, Depends
from app.core.security import get_current_user

router = APIRouter(prefix='/docs', tags=['docs'])


@router.get('')
async def docs(_=Depends(get_current_user)):
    return {'title': 'BITS reports Documentation', 'sections': [
        {'title': 'Lifecycle', 'body': 'Report → Classify → Prioritise → Assign → Acknowledge → Investigate → Resolve → Verify → Close. '
                                       'The State pattern blocks illegal moves and role-inappropriate moves.'},
        {'title': 'Design Patterns', 'body': 'Strategy (priority and assignment), State (lifecycle), Factory (users, incidents), '
                                             'Observer (audit, notifications, SLA violations), Repository (MongoDB access), '
                                             'Adapter (SMTP email, Gemini AI, Google Maps links), Value Objects (GeoPoint, '
                                             'HandoverCode), Factory + polymorphism (photo / voice attachments).'},
        {'title': 'Field service', 'body': 'Reports carry the exact spot (phone GPS, or the building pin). Technicians get '
                                          'one-tap Google Maps directions, mark "on my way", and check in with a GPS-verified '
                                          'arrival. Hostel repairs are closed with the student\'s 4-digit handover code. '
                                          'Photos (before/after) and voice notes attach to any incident; QR stickers on '
                                          'equipment open a pre-filled report. Pages update live (Server-Sent Events) and a '
                                          'campus map shows hotspots and building-wide outages.'},
        {'title': 'Intelligent Features', 'body': 'AI-assisted reporting and categorisation, duplicate detection, incident correlation, '
                                                  'smart technician recommendation, SLA risk detection, automatic escalation and '
                                                  'suggested resolutions.'},
    ]}
