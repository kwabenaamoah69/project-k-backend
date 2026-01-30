class Matchmaker {
    constructor() {
        this.queues = {}; 
    }

    addPlayer(socket, gameType, stake) {
        const queueKey = `${gameType}_${stake}`;

        // Create queue if needed
        if (!this.queues[queueKey]) {
            this.queues[queueKey] = [];
        }

        const queue = this.queues[queueKey];

        // CHECK: Is someone waiting?
        if (queue.length > 0) {
            const opponentSocket = queue.shift(); 
            const matchId = `match_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

            return {
                status: 'MATCH_FOUND',
                matchId: matchId,
                player1: opponentSocket,
                player2: socket
            };
        } else {
            queue.push(socket);
            return { status: 'WAITING' };
        }
    }

    removePlayer(socketId) {
        for (const key in this.queues) {
            this.queues[key] = this.queues[key].filter(s => s.id !== socketId);
        }
    }
}

// 👇 THIS IS THE MOST IMPORTANT LINE. DO NOT MISS IT. 👇
module.exports = new Matchmaker();