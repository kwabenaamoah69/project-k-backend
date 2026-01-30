const run = async () => {
    try {
        console.log("Attempting to register user...");
        
        const response = await fetch('http://localhost:5000/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: "NanaKwame", 
                phone: "0540000001",
                password: "mypassword123"
            })
        });

        const data = await response.json();
        console.log("SERVER REPLIED:", data);
    } catch (error) {
        console.log("ERROR:", error.message);
    }
};

run();