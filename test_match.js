const io = require('socket.io-client');

// 1. Setup KWAME (User ID 1)
const socket1 = io('http://localhost:5000');
let kwameMatchId = null;

socket1.on('connect', () => {
    console.log('✅ Kwame (User 1) connected.');
    // Notice we added 'userId: 1' here
    socket1.emit('FIND_MATCH', { gameType: 'SPAR', stake: 10, userId: 1 });
});

socket1.on('GAME_START', (data) => {
    kwameMatchId = data.matchId;
    setTimeout(() => { socket1.emit('ROLL_DICE', { matchId: kwameMatchId }); }, 1000);
});

socket1.on('GAME_OVER', (data) => {
    console.log(`🏁 GAME OVER! Result: ${data.message}`);
});


// 2. Setup AMA (User ID 2)
setTimeout(() => {
    const socket2 = io('http://localhost:5000');
    let amaMatchId = null;

    socket2.on('connect', () => {
        console.log('✅ Ama (User 2) connected.');
        // Notice we added 'userId: 2' here
        socket2.emit('FIND_MATCH', { gameType: 'SPAR', stake: 10, userId: 2 });
    });

    socket2.on('GAME_START', (data) => {
        amaMatchId = data.matchId;
        socket2.emit('ROLL_DICE', { matchId: data.matchId });
    });

}, 2000);