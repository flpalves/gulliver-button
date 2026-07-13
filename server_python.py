#!/usr/bin/env python3
"""
Gulliver Multiplayer Server - Python version
Flask + Python-SocketIO for local testing
"""

from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO, emit, join_room
import random
import string
import os

# Get the directory where this script is located
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, static_folder=BASE_DIR, static_url_path='')
app.config['SECRET_KEY'] = 'gulliver-secret-dev'
socketio = SocketIO(app, cors_allowed_origins="*")

# Room management: { code: { yellow_socket_id, blue_socket_id, game_config } }
rooms = {}

def generate_room_code():
    """Generate a random 4-letter room code"""
    return ''.join(random.choices(string.ascii_uppercase, k=4))

@app.route('/')
def index():
    """Serve the game HTML"""
    return send_from_directory(BASE_DIR, 'index.html')

@app.route('/<path:filename>')
def serve_static(filename):
    """Serve static files (CSS, JS, etc)"""
    return send_from_directory(BASE_DIR, filename)

@socketio.on('create_room')
def on_create_room(data):
    """Handle room creation"""
    game_config = data

    # Generate unique room code
    code = generate_room_code()
    while code in rooms:
        code = generate_room_code()

    # Store room
    rooms[code] = {
        'yellow_socket': request.sid,
        'blue_socket': None,
        'game_config': game_config
    }

    join_room(code)
    print(f'[ROOM] {code} created by {request.sid} (yellow)')
    emit('room_created', {'roomCode': code})

@socketio.on('join_room')
def on_join_room(code):
    """Handle joining a room"""
    code = code.upper()  # Case-insensitive

    if code not in rooms:
        print(f'[ERROR] {request.sid} tried to join non-existent room {code}')
        emit('join_error', {'message': 'Room does not exist'})
        return

    room = rooms[code]

    if room['blue_socket'] is not None:
        print(f'[ERROR] {request.sid} tried to join full room {code}')
        emit('join_error', {'message': 'Room is full'})
        return

    # Add blue player
    room['blue_socket'] = request.sid
    join_room(code)

    print(f'[ROOM] {code} joined by {request.sid} (blue)')

    # Notify both players
    socketio.emit('room_ready', {
        'yellowSocketId': room['yellow_socket'],
        'blueSocketId': room['blue_socket'],
        'gameConfig': room['game_config']
    }, room=code)

@socketio.on('shot_fired')
def on_shot_fired(payload):
    """Relay shot_fired event"""
    # Find which room this socket belongs to
    for code, room in rooms.items():
        if request.sid == room['yellow_socket'] or request.sid == room['blue_socket']:
            emit('shot_fired', payload, room=code, skip_sid=request.sid)
            print(f'[SHOT] {code} - {request.sid} fired shot')
            break

@socketio.on('reposition')
def on_reposition(payload):
    """Relay reposition event"""
    for code, room in rooms.items():
        if request.sid == room['yellow_socket'] or request.sid == room['blue_socket']:
            emit('reposition', payload, room=code, skip_sid=request.sid)
            break

@socketio.on('physics_settled')
def on_physics_settled(payload):
    """Relay physics_settled event"""
    for code, room in rooms.items():
        if request.sid == room['yellow_socket'] or request.sid == room['blue_socket']:
            emit('physics_settled', payload, room=code, skip_sid=request.sid)
            print(f'[PHYSICS] {code} - {request.sid} settled')
            break

@socketio.on('game_event')
def on_game_event(payload):
    """Relay game_event"""
    for code, room in rooms.items():
        if request.sid == room['yellow_socket'] or request.sid == room['blue_socket']:
            emit('game_event', payload, room=code, skip_sid=request.sid)
            print(f'[EVENT] {code} - {payload.get("type", "unknown")}')
            break

@socketio.on('disconnect')
def on_disconnect():
    """Handle client disconnect"""
    for code, room in rooms.items():
        if request.sid == room['yellow_socket'] or request.sid == room['blue_socket']:
            emit('opponent_disconnected', room=code)
            print(f'[DISCONNECT] {request.sid} from {code}')
            # Clean up room
            del rooms[code]
            break

    print(f'[DISCONNECT] {request.sid}')

if __name__ == '__main__':
    print('[SERVER] Gulliver server listening on http://localhost:3000')
    socketio.run(app, host='0.0.0.0', port=3000, debug=False, allow_unsafe_werkzeug=True)
