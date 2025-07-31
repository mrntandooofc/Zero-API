// api/example/hello.js
module.exports = {
    meta: {
        name: 'Hello API',
        path: '/example/hello',
        description: 'A simple hello API endpoint',
        method: 'GET',
        category: 'Example',
        author: 'Mr Ntando Ofc'
    },
    onStart: async ({ req, res }) => {
        res.json({
            message: 'Hello, world!'
        });
    }
};
