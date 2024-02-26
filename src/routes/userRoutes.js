const { register_user, login_user, contact_us, update_password } = require('../controllers/userController')
const express = require('express');
const bodyParser = require('body-parser');


const user_router = express.Router()

user_router.use(bodyParser.json());

user_router.post('/register', register_user);

user_router.post('/login', login_user);

user_router.post('/contact', contact_us);

user_router.post('/update-password', update_password);

user_router.get('/amittest', (req, res) => {
    res.send('Amit')
});

module.exports = user_router
