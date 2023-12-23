require('dotenv').config();

const io = require("socket.io")(3001, {
    cors: {
        origin: `${process.env.LOCALHOST}`,
        methods: ['GET', 'POST']
    },
})


let countdownState = {
    seconds: 0,
    interval: null,
    startTime: null,
    pausedTime: 0,
};

const rooms = {};

io.on("connection", (socket) => {
    console.log('A user connected');

    socket.on('createRoom', ({ username }, callback) => {
        const roomId = generateUniqueRoomId();
        rooms[roomId] = {
            roomData: [{ socketId: socket.id, username, isActivePlayer: true }],
            roomSettings: {
                players: 6,
                rounds: 4,
                drawTime: 60,
                hints: 1,
                isStarted: false
            }
        };
        socket.join(roomId);
        callback({ roomId, socketId: socket.id, roomData: rooms[roomId].roomData })
        socket.emit('roomCreated', { socketId: socket.id, roomId, roomData: rooms[roomId].roomData });
    });

    socket.on('joinRoom', ({ roomId, username }, callback) => {
        if (roomId in rooms) {
            rooms[roomId]?.roomData?.push({ socketId: socket.id, username, isActivePlayer: false }); // Add user to the room's array
            socket.join(roomId);
            callback({ roomId, socketId: socket.id, roomData: rooms[roomId].roomData });
            io.to(roomId).emit('userJoined', { socketId: socket.id, roomId, roomData: rooms[roomId].roomData });
        } else {
            socket.emit('roomNotFound');
        }
    });

    socket.on('getUsers', (roomId) => {
        socket.emit('usersList', rooms[roomId]);
    })

    socket.on('startGame', ({ roomId }) => {
        rooms[roomId].roomSettings.isStarted = true;
        io.to(roomId).emit('changeStateToStarted', true);
    })

    socket.on('checkRoom', async ({ roomId }) => {
        try {
            // console.log('rooms', JSON.stringify(rooms));
            const roomExists = await checkRoom(roomId);
            io.to(socket.id).emit('check-room-status', { roomExists, room: rooms[roomId] });
        } catch (error) {
            console.error('Error checking room:', error);
        }
    });

    socket.on('newClient', () => {
        socket.broadcast.emit('get-canvas-state');
    });

    socket.on('draw', ({ x, y, color, brushSize }) => {
        socket.broadcast.emit('drawFromServer', { x, y, color, brushSize });
    })

    socket.on('startCountdown', (seconds) => {
        startCountdown(seconds);

        io.to(socket.id).emit('countdown', countdownState.seconds);
    });

    socket.on('stopCountdown', () => {
        stopCountdown();
    });

    socket.on('getInitialCountdown', () => {
        const elapsedSeconds = Math.floor((Date.now() - countdownState.startTime) / 1000);
        const remainingSeconds = Math.max(0, countdownState.seconds - elapsedSeconds);
        io.to(socket.id).emit('countdown', remainingSeconds);
    });

    socket.on('restoreDrawing', ({ commands, index }) => {
        socket.broadcast.emit('restoreDrawing', { commands, index });
    });

    socket.on('clearCanvas', () => {
        socket.broadcast.emit('clearCanvas');
    });

    socket.on('fillColor', ({ selectedColor }) => {
        socket.broadcast.emit('fillColor', { selectedColor });
    });

    socket.on('setRoomSettings', ({ roomSettings, roomId }) => {
        rooms[roomId].roomSettings = roomSettings;
        io.to(roomId).emit('broadcastRoomSettings', { roomSettings });
    });

    socket.on('get-room-settings', ({ roomId }) => {
        io.to(roomId).emit('getRoomSettings', { roomSettings: rooms[roomId]?.roomSettings });
    });

    socket.on('canvas-state', (currentDrawingState) => {
        socket.broadcast.emit('restoreDrawing', { commands: [{ type: 'draw', dataURL: currentDrawingState }] });
    });

    socket.on('selectedWord', ({ word, roomId, position }) => {
        io.to(roomId).emit('getSelectedWord', { word, position });
    })

    socket.on('disconnected-from-game', ({ roomId, socketId }) => {
        if (roomId) {
            if (rooms[roomId]?.roomData.length === 1) {
                delete rooms[roomId];
            } else {
                const index = rooms[roomId]?.roomData.map(rd => rd.socketId).indexOf(socketId)
                if (index !== -1) {
                    rooms[roomId]?.roomData.splice(index, 1);
                    io.to(roomId).emit('changeInUsers', { newRoomData: rooms[roomId]?.roomData, prevRoomId: roomId });
                }
            }
        }
    });

    io.to(socket.id).emit('countdown', countdownState.seconds);
});

io.on('disconnect', (socket) => {
    countdownState = {
        seconds: 0,
        interval: null,
        startTime: null,
        pausedTime: 0,
    };

    for (const roomId in rooms) {
        const index = rooms[roomId].roomData.indexOf(socket.id);
        if (index !== -1) {
            rooms[roomId].roomData.splice(index, 1);
            io.to(roomId).emit('userLeft', socket.id);
            break;
        }
    }
});

// Function to start the countdown
const startCountdown = (seconds) => {
    if (!countdownState.interval) {
        const startTime = Date.now() - countdownState.pausedTime;
        countdownState.interval = setInterval(() => {
            const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
            const remainingSeconds = Math.max(0, seconds - elapsedSeconds);

            io.emit('countdown', remainingSeconds);

            // Stop the countdown when it reaches 0
            if (remainingSeconds === 0) {
                clearInterval(countdownState.interval);
                countdownState.interval = null;
            }
        }, 1000);
    }
};

// Function to stop the countdown
const stopCountdown = () => {
    if (countdownState.interval) {
        clearInterval(countdownState.interval);
        countdownState.interval = null;
        countdownState.pausedTime = Date.now() - countdownState.startTime;
    }
};

function generateUniqueRoomId() {
    let roomId;
    do {
        roomId = Math.random().toString(36).substring(7);
    } while (rooms[roomId]);

    return roomId;
}

async function checkRoom(roomId) {
    let check = rooms[roomId]?.roomData.length ? true : false;
    return check;
}