const pool = require("../../config/database");
const bcrypt = require('bcrypt');


// check existing users
const checkUserExists = async (email) => {
  const client = await pool.connect();

  try {
    const queryText = "SELECT * FROM users WHERE email = $1";
    const result = await client.query(queryText, [email]);
    return result.rows.length > 0;
  } catch (err) {
    console.error("Error checking user existence:", err);
    throw err;
  } finally {
    client.release();
  }
};

// function for registering user
const registerUser = async (fullName, email, password) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const hashedPassword = await bcrypt.hash(password, 10);

    const queryText =
      "INSERT INTO users (full_name, email, password) VALUES ($1, $2, $3) RETURNING *";
    const values = [fullName, email, hashedPassword];
    const result = await client.query(queryText, values);

    await client.query("COMMIT");
    return result.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// Register endpoint with bcrypt
const register_user = async (req, res) => {
  const { fullName, email, password, confirmPassword } = req.body;

  const userExists = await checkUserExists(email);
  if (userExists) {
    return res.status(400).json({ error: "User already exists" });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ error: "Passwords do not match" });
  }

  try {
    const user = await registerUser(fullName, email, password);
    return res
      .status(201)
      .json({ message: "User registered successfully", user });
  } catch (err) {
    console.error("Error registering user:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};


// Authenticate user with bcrypt
const authenticateUser = async (email, password) => {
  const queryText = "SELECT * FROM users WHERE email = $1";
  const values = [email];
  try {
    const result = await pool.query(queryText, values);
    const user = result.rows[0];

    if (user) {
      // Compare the provided password with the stored hashed password
      const passwordMatch = await bcrypt.compare(password, user.password);

      if (passwordMatch) {
        return user;
      }
    }

    return null; // Return null if user doesn't exist or passwords don't match
  } catch (err) {
    throw err;
  }
};

// Login EndPoint with bcrypt
const login_user = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await authenticateUser(email, password);

    if (user) {
      res.status(200).json({ message: "Login successful", user });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  } catch (err) {
    console.error("Error authenticating user:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// // update password
// const updatePassword = async (email, currentPassword, newPassword) => {
//   const queryText =
//     "UPDATE users SET password = $1 WHERE email = $2 AND password = $3 RETURNING *";
//   const values = [newPassword, email, currentPassword];

//   try {
//     const result = await pool.query(queryText, values);

//     if (result.rows.length === 0) {
//       return null;
//     }

//     return result.rows[0];
//   } catch (err) {
//     throw err;
//   }
// };

// // update Password
// const update_password = async (req, res) => {
//   const { email, currentPassword, newPassword, confirmPassword } = req.body;

//   if (newPassword !== confirmPassword) {
//     return res.status(400).json({ error: "New passwords do not match" });
//   }
//   try {
//     const updatedUser = await updatePassword(
//       email,
//       currentPassword,
//       newPassword
//     );
//     if (updatedUser) {
//       res
//         .status(200)
//         .json({ message: "Password updated successfully", updatedUser });
//     } else {
//       res.status(401).json({ error: "Invalid credentials" });
//     }
//   } catch (err) {
//     console.error("Error updating password:", err);
//     res.status(500).json({ error: "Internal Server Error" });
//   }
// };


// Update password with bcrypt
const updatePassword = async (email, currentPassword, newPassword) => {
  const getUserQuery = "SELECT * FROM users WHERE email = $1";
  const values = [email];

  try {
    const result = await pool.query(getUserQuery, values);
    const user = result.rows[0];

    if (!user) {
      return null; 
    }

    // Compare the provided current password with the stored hashed password
    const passwordMatch = await bcrypt.compare(currentPassword, user.password);

    if (passwordMatch) {
      // Hash the new password before updating it
      const hashedNewPassword = await bcrypt.hash(newPassword, 10);

      // Update the password in the database
      const updateQuery = "UPDATE users SET password = $1 WHERE email = $2 RETURNING *";
      const updateValues = [hashedNewPassword, email];
      const updateResult = await pool.query(updateQuery, updateValues);

      return updateResult.rows[0];
    } else {
      return null;
    }
  } catch (err) {
    throw err;
  }
};

// Update Password endpoint with bcrypt
const update_password = async (req, res) => {
  const { email, currentPassword, newPassword, confirmPassword } = req.body;

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: "New passwords do not match" });
  }

  try {
    const updatedUser = await updatePassword(email, currentPassword, newPassword);

    if (updatedUser) {
      res.status(200).json({ message: "Password updated successfully", updatedUser });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  } catch (err) {
    console.error("Error updating password:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};


// save contact us details
const saveContactMessage = async (fullName, email, subject, message) => {
  const queryText =
    "INSERT INTO contact_messages (full_name, email, subject, message) VALUES ($1, $2, $3, $4) RETURNING *";
  const values = [fullName, email, subject, message];

  try {
    const result = await pool.query(queryText, values);
    return result.rows[0];
  } catch (err) {
    throw err;
  }
};


// Contact Us
const contact_us = async (req, res) => {
  const { fullName, email, subject, message } = req.body;

  console.log(req.body);

  try {
    const savedMessage = await saveContactMessage(
      fullName,
      email,
      subject,
      message
    );

    res
      .status(201)
      .json({ message: "Contact message saved successfully", savedMessage });
  } catch (err) {
    console.error("Error saving contact message:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};



// update Api key for social 




module.exports = {
  register_user,
  registerUser,
  login_user,
  contact_us,
  update_password,
};
