from fastapi import APIRouter,Depends
from bson import ObjectId
from bson.errors import InvalidId
from app.core.db import db
from app.core.security import get_current_user
from app.models.schemas import clean_doc
from app.domain.exceptions import ResourceNotFoundError
router=APIRouter(prefix='/notifications',tags=['notifications'])
@router.get('')
async def listing(user=Depends(get_current_user)):
    docs=await db.notifications.find({'user_id':user['id']}).sort('created_at',-1).limit(50).to_list(50); unread=sum(not d.get('read',False) for d in docs); return {'items':[clean_doc(x) for x in docs],'unread':unread}
@router.post('/{nid}/read')
async def read(nid,user=Depends(get_current_user)):
    try:
        notification_id=ObjectId(nid)
    except InvalidId as exc:
        raise ResourceNotFoundError('Notification not found') from exc
    result=await db.notifications.update_one({'_id':notification_id,'user_id':user['id']},{'$set':{'read':True}})
    if not result.matched_count:
        raise ResourceNotFoundError('Notification not found')
    return {'ok':True}
@router.post('/read-all')
async def all_read(user=Depends(get_current_user)):await db.notifications.update_many({'user_id':user['id'],'read':False},{'$set':{'read':True}});return {'ok':True}
