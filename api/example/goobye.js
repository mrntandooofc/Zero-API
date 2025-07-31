// api/example/goodbye.js
module.exports = {
    meta: {
        name: 'Goodbye API',
        path: '/example/goodbye',
        description: 'A simple goodbye API endpoint',
        method: 'GET',
        category: 'Example',
        author: 'Mr Ntando ofc'
    },
    onStart: async ({ req, res }) => {
        res.json({
            message: 'Goodbye, world!'
        });
    }
};
