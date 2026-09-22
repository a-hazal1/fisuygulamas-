from pathlib import Path
import json
import logging
import traceback

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import Response, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from scan import detect_from_bytes, warp_from_bytes, scan_image, DocumentNotFound

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / 'frontend'

app = FastAPI(title='Fiş Toplama Hybrid Scanner')

@app.get('/health')
def health():
    return {'ok': True, 'scanner': 'hybrid-quad-v1'}

@app.post('/detect')
async def detect(file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        raise HTTPException(400, 'EMPTY_IMAGE')
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(413, 'IMAGE_TOO_LARGE')
    try:
        return await run_in_threadpool(detect_from_bytes, data)
    except Exception as e:
        logging.error('DETECT_FAILED\n%s', traceback.format_exc())
        raise HTTPException(500, f'DETECT_FAILED: {type(e).__name__}: {e}')

@app.post('/warp')
async def warp(
    file: UploadFile = File(...),
    corners: str = Form(...),
    mode: str = Form('scan'),
):
    data = await file.read()
    try:
        pts = json.loads(corners)
        result = await run_in_threadpool(warp_from_bytes, data, pts, mode)
        return Response(result, media_type='image/jpeg')
    except DocumentNotFound:
        raise HTTPException(422, 'NO_DOCUMENT')
    except Exception as e:
        logging.error('WARP_FAILED\n%s', traceback.format_exc())
        raise HTTPException(500, f'WARP_FAILED: {type(e).__name__}: {e}')

@app.post('/scan')
async def scan(file: UploadFile = File(...)):
    data = await file.read()
    try:
        result, confidence = await run_in_threadpool(scan_image, data)
        return Response(result, media_type='image/jpeg', headers={'X-Scan-Confidence': f'{confidence:.3f}'})
    except DocumentNotFound:
        raise HTTPException(422, 'NO_DOCUMENT')
    except Exception as e:
        logging.error('SCAN_FAILED\n%s', traceback.format_exc())
        raise HTTPException(500, f'SCAN_FAILED: {type(e).__name__}: {e}')

app.mount('/assets', StaticFiles(directory=FRONTEND_DIR), name='assets')

@app.get('/')
def index():
    return FileResponse(FRONTEND_DIR / 'index.html')
