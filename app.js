require("dotenv").config();
const express = require("express");
const pool = require("./config/database");
const axios = require("axios");
const cors = require("cors");
const user_router = require("./src/routes/userRoutes");
const path = require("path");
const dayjs = require("dayjs");
const bcrypt = require("bcrypt");

const passport = require("passport");
const FacebookStrategy = require("passport-facebook").Strategy;
const session = require("express-session");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const config = require("./config/config");

const fs = require("fs");

const { IgApiClient } = require("instagram-private-api");
const { get } = require("request-promise");
const cron = require("node-cron");
const { CronJob } = require("cron");
const moment = require("moment-timezone");

const { download } = require("./utilities");

const { TwitterApi } = require("twitter-api-v2");

const multer = require("multer");
const { post } = require("request");

const port = 4000;
// const port = process.env.PORT || 3000;
const app = express();
const staticPath = path.join(__dirname, "uploads");
app.use("/backend/uploads", express.static(staticPath));
app.use(bodyParser.urlencoded({ extended: true }));

// Middle ware
app.use(cors());

// app.use(
//   cors({
//     origin: ["http://localhost:3001", "https://socialize-dev.heytech.vision/"],
//     methods: "GET,POST,PUT,DELETE",
//     credentials: true,
//   })
// );

// app.use((req, res, next) => {
//   res.setHeader("Access-Control-Allow-Origin", "http://localhost:3001");
//   res.setHeader(
//     "Access-Control-Allow-Methods",
//     "GET, POST, OPTIONS, PUT, PATCH, DELETE"
//   );
//   res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
//   res.setHeader("Access-Control-Allow-Credentials", "true");
//   next();
// });

app.use("/backend/api/", user_router);

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
  next();
});

// Set EJS as the view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "src/views"));

// Test the database connection
pool.query("SELECT NOW()", (err, result) => {
  if (err) {
    console.error("Error connecting to the database:", err);
  } else {
    console.log("Connected to the database:", result.rows[0].now);
  }
});

app.listen(port, () => {
  console.log(`server is working ${port}`);
});

//++++++++++++++++++++++++++++++++++++++++++++ Facebook Interegation ++++++++++++++++++++++++++++++++++++++++++++

// Passport session setup.
passport.serializeUser(function (user, done) {
  done(null, user);
});

passport.deserializeUser(function (obj, done) {
  done(null, obj);
});

passport.use(
  new FacebookStrategy(
    {
      clientID: config.facebook_api_key,
      clientSecret: config.facebook_api_secret,
      callbackURL: config.callback_url,
      profileFields: ["id", "displayName", "photos", "email", "accounts"],
      enableProof: true,
    },
    function (accessToken, refreshToken, profile, done) {
      console.log(accessToken, refreshToken, profile);
      process.nextTick(async function () {
        // Check whether the User exists or not using profile.id
        if (config.use_database) {
          pool.query(
            "SELECT * from user_info where user_id=" + profile.id,
            (err, rows) => {
              if (err) throw err;
              if (rows && rows.length === 0) {
                console.log("There is no such user, adding now");
                pool.query(
                  "INSERT into user_info(user_id,user_name) VALUES('" +
                    profile.id +
                    "','" +
                    profile.username +
                    "')"
                );
              } else {
                console.log("User already exists in the database");
              }
            }
          );
        }

        // Store the access token in the session
        profile.accessToken = accessToken;
        let firstPageId;

        if (profile && profile._json && profile._json.accounts) {
          const pages = profile._json.accounts.data;
          if (pages && pages.length > 0) {
            firstPageId = pages[0].id;
            console.log("User's first page ID:", firstPageId);
          }
        }

        let email = profile.email;
        let facebook_page_id = firstPageId;
        let facebook_access_token = profile.accessToken;

        const userExistsQuery = "SELECT * FROM users WHERE email = $1";
        const userExistsResult = await pool.query(userExistsQuery, [email]);

        if (userExistsResult.rows.length === 0) {
          return res.status(404).json({ error: "Email not found" });
        }
        const tokenExpiryTime = new Date();
        tokenExpiryTime.setHours(tokenExpiryTime.getHours() + 1);

        const indiaTimeZone = "Asia/Kolkata";
        const formattedExpiryTime = tokenExpiryTime.toLocaleString("en-US", {
          timeZone: indiaTimeZone,
        });
        const updateUserQuery =
          "UPDATE users SET facebook_page_id = $1, facebook_access_token = $2, facebook_token_expiry_time = $3 WHERE email = $4";

        await pool.query(updateUserQuery, [
          facebook_page_id,
          facebook_access_token,
          formattedExpiryTime,
          email,
        ]);

        return done(null, profile);
      });
    }
  )
);

app.set("views", __dirname + "/views");
app.set("view engine", "ejs");
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(session({ secret: "keyboard cat", key: "sid" }));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(__dirname + "/public"));

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Twitter Get Information  ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
const TwitterStrategy = require("passport-twitter").Strategy;
// Replace these values with your Twitter API credentials

const TWITTER_CONSUMER_KEY = "tF8P7V2dotmnb700TRGOaFj2J";
const TWITTER_CONSUMER_SECRET =
  "wFwKTtpheTLkw4UX97gCcAXFqoodbqqaBsYT57U9GAuGxA5z0J";

passport.use(
  new TwitterStrategy(
    {
      consumerKey: TWITTER_CONSUMER_KEY,
      consumerSecret: TWITTER_CONSUMER_SECRET,
      // callbackURL:
      //   "https://socialize-dev.heytech.vision/backend/api/auth/twitter/callback",
      callbackURL: "http://localhost:3000/auth/twitter/callback",
      includeEmail: true,
    },
    async function (token, tokenSecret, profile, done) {
      console.log("token", token);
      console.log("tokensecret", tokenSecret);
      console.log("profile", profile);
      const email =
        profile.emails && profile.emails.length > 0
          ? profile.emails[0].value
          : null;
      const userInformation = {
        id: profile.id,
        displayName: profile.displayName,
        username: profile.username,
        email: email,
        token: token,
        tokenSecret: tokenSecret,
      };
      console.log(userInformation);
      let TWITTER_ACCESS_TOKEN = token;
      let TWITTER_ACCESS_SECRET = tokenSecret;
      let TWITTER_API_KEY = TWITTER_CONSUMER_KEY;
      let TWITTER_API_SECRET = TWITTER_CONSUMER_SECRET;
      let TWITTER_BEARER_TOKEN =
        "AAAAAAAAAAAAAAAAAAAAACQ4sQEAAAAAZC2hJkMHjYsggoWN%2BN4SC8hPu8M%3DVMQWsD0Pq0laJiFdv6h8Vt6fMGqomPS0zjbUVEjcgAz4cW5EaH";
      let TWITTER_APP_ID = "28391460";

      const checkEmailQuery = `
              SELECT * FROM users
              WHERE email = $1
          `;
      const emailCheckResult = await pool.query(checkEmailQuery, [email]);

      if (emailCheckResult.rows.length > 0) {

        const updateQuery = `
      UPDATE users
      SET TWITTER_API_KEY = $2, TWITTER_API_SECRET = $3,
      TWITTER_ACCESS_TOKEN = $4, TWITTER_ACCESS_SECRET = $5, TWITTER_BEARER_TOKEN = $6, TWITTER_APP_ID = $7
      WHERE email = $1
  `;

        const updateValues = [
          email,
          TWITTER_API_KEY,
          TWITTER_API_SECRET,
          TWITTER_ACCESS_TOKEN,
          TWITTER_ACCESS_SECRET,
          TWITTER_BEARER_TOKEN,
          TWITTER_APP_ID,
        ];
        await pool.query(updateQuery, updateValues);
        console.log("upadate value");
      }

      return done(null, userInformation);
    }
  )
);

// Serialize and deserialize user information to store in session
passport.serializeUser(function (user, done) {
  done(null, user);
});

passport.deserializeUser(function (obj, done) {
  done(null, obj);
});

// Use express-session middleware
app.use(
  require("express-session")({
    secret: "your_session_secret",
    resave: true,
    saveUninitialized: true,
  })
);

// Initialize Passport and restore authentication state from session
app.use(passport.initialize());
app.use(passport.session());

// Api Start+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

// Get Instagram User Info
async function getUserInfo(username, password) {
  const ig = new IgApiClient();
  ig.state.generateDevice(username);
  await ig.account.login(username, password);
  const userId = await ig.user.getIdByUsername(username);
  const user = await ig.user.info(userId);

  return user;
}

// get instagram user
app.post("/backend/api/get_instagram_user_info", async (req, res) => {
  const { email } = req.body;
  let username;
  let password;

  // Check if the email exists in the database
  const getUserQuery = `
          SELECT * FROM users
          WHERE email = $1
      `;
  const userResult = await pool.query(getUserQuery, [email]);

  if (userResult.rows.length > 0) {
    username = userResult.rows[0].instagram_username;
    password = userResult.rows[0].ig_password;
    console.log(username, password);
  } else {
    res.status(404).json({ error: "User not found" });
  }

  try {
    const userInfo = await getUserInfo(username, password);
    let instagram_username = userInfo.username;
    let instagram_full_name = userInfo.full_name;
    let instagram_followers = userInfo.follower_count;
    let instagram_following = userInfo.following_count;
    let instagram_posts = userInfo.media_count;

    // Check if the email exists in the database
    const usernameQuery = "SELECT * FROM users WHERE instagram_username = $1";
    const userExistsResult = await pool.query(usernameQuery, [
      instagram_username,
    ]);

    if (userExistsResult.rows.length === 0) {
      return res.status(404).json({ error: "Email not found" });
    }

    const updateUserQuery =
      "UPDATE users SET instagram_full_name = $1, instagram_followers = $2, instagram_following = $3, instagram_posts = $4 WHERE instagram_username = $5";

    await pool.query(updateUserQuery, [
      instagram_full_name,
      instagram_followers,
      instagram_following,
      instagram_posts,
      instagram_username,
    ]);

    let showjsondata = {
      instagram_full_name,
      instagram_followers,
      instagram_following,
      instagram_posts,
      instagram_username,
    };

    res.json({ message: "Data Success Fully Fetched", showjsondata });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/backend/api/get_facebook_user_info", async (req, res) => {
  let { email } = req.body;
  try {
    console.log(req.body);
    let facebook_page_id;
    let facebook_access_token;
    // Get user credentials from the database
    const getUserQuery = `
      SELECT * FROM users
      WHERE email = $1
    `;
    const userResult = await pool.query(getUserQuery, [email]);
    console.log(userResult);
    if (userResult.rows.length > 0) {
      const userData = userResult.rows[0];
      console.log(userData);
      facebook_page_id = userData.facebook_page_id;
      facebook_access_token = userData.facebook_access_token;

      console.log(facebook_access_token, facebook_page_id);

      const response = await axios.get(
        `https://graph.facebook.com/v12.0/${facebook_page_id}?fields=about,followers_count&access_token=${facebook_access_token}`
      );
      const facebook_data = response.data;
      console.log(facebook_data);
      res.send({
        message: "Facebook Data successfully retrieved",
        facebook_data,
      });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Schdule post
app.post(
  "/backend/api/schedule-post",
  upload.fields([{ name: "imagePost", maxCount: 1 }]),
  async (req, res) => {
    try {
      // variable Defined
      let API_KEY = "";
      let API_SECRET = "";
      let ACCESS_TOKEN = "";
      let ACCESS_SECRET = "";
      let BEARER_TOKEN = "";
      let scheduledPostId;
      let image_post_uri;
      let updated_post_content;
      let updated_social_media_array;
      let update_schedule_time;
      let cronExpression;
      let facebook_access_token;
      let facebook_page_id;
      let IG_USERNAME;
      let IG_PASSWORD;

      const { social_media_array, email, post_content } = req.body;
      const socialMediaArray = JSON.parse(social_media_array);
      const schedule_time = dayjs(req.body.schedule_time);

      if (!schedule_time.isValid()) {
        return res.status(400).json({ error: "Invalid schedule_time format" });
      }

      if (!req.files["imagePost"] || !req.files["imagePost"][0]) {
        return res.status(400).json({ error: "Image file not provided" });
      }
      const imageFile = req.files["imagePost"][0];
      const imageBuffer = imageFile.buffer;
      const imageFilename = `${Date.now()}-${Math.floor(
        Math.random() * 1000
      )}.png`;

      const imagePath = path.join(__dirname, "uploads", imageFilename);
      fs.writeFileSync(imagePath, imageBuffer);

      let imageUrl = `${process.env.BACKEND_BASE_URL}/uploads/${imageFilename}`;

      // Insert The Data in Database
      const insertQuery = `
                  INSERT INTO scheduled_posts (social_media_array, schedule_time, image_post, post_content, email)
                  VALUES ($1, $2, $3, $4, $5)
                  RETURNING id; -- This returns the ID of the inserted record
              `;

      const insertValues = [
        socialMediaArray,
        schedule_time.toISOString(),
        imageUrl,
        post_content,
        email,
      ];

      const result = await pool.query(insertQuery, insertValues);
      console.log(result, "result Here");
      scheduledPostId = result.rows[0].id;

      cronExpression = `${schedule_time.minute()} ${schedule_time.hour()} ${schedule_time.date()} ${
        schedule_time.month() + 1
      } ${schedule_time.day()}`;
      console.log(cronExpression);

      const cronJob = new CronJob(cronExpression, async () => {
        try {
          console.log("cron job Start");
          // Get Post Details By ID
          const query = "SELECT * FROM scheduled_posts WHERE id = $1";
          const result_post = await pool.query(query, [scheduledPostId]);

          if (result_post.rows.length > 0) {
            const postData = result_post.rows[0];
            image_post_uri = postData.image_post;
            updated_post_content = postData.post_content;
            updated_social_media_array = postData.social_media_array;
            update_schedule_time = postData.schedule_time;

            console.log(
              updated_social_media_array,
              "updated_social_media_array"
            );
            console.log(update_schedule_time, "update_schedule_time");
            console.log(updated_post_content, "updated_post_content");
          } else {
            console.log("post Not Found");
          }

          console.log("first step");

          // get User Data From the Data base
          const getUserQuery = `
                        SELECT * FROM users
                        WHERE email = $1
                    `;

          console.log(email, "emswil");
          const userResult = await pool.query(getUserQuery, [email]);

          console.log("second step");
          console.log(userResult, "user re");
          if (userResult.rows.length > 0) {
            console.log("third");
            console.log(userResult, "user Result");
            const userData = userResult.rows[0];
            console.log(userData);
            API_KEY = userData.twitter_api_key;
            API_SECRET = userData.twitter_api_secret;
            ACCESS_TOKEN = userData.twitter_access_token;
            ACCESS_SECRET = userData.twitter_access_secret;
            BEARER_TOKEN = userData.twitter_bearer_token;
            (facebook_access_token = userData.facebook_access_token),
              (facebook_page_id = userData.facebook_page_id);
            IG_USERNAME = userData.instagram_username;
            IG_PASSWORD = userData.ig_password;
          } else {
            console.log("userr Not Found");
          }

          // Twitter APi Implementation
          const client = new TwitterApi({
            appKey: API_KEY,
            appSecret: API_SECRET,
            accessToken: ACCESS_TOKEN,
            accessSecret: ACCESS_SECRET,
          });

          const bearer = new TwitterApi(BEARER_TOKEN);

          const twitterClient = client.readWrite;
          const twitterBearer = bearer.readOnly;

          const tweet = async () => {
            const uri = image_post_uri;
            const filename = "image.png";
            download(uri, filename, async function () {
              try {
                const mediaId = await twitterClient.v1.uploadMedia(
                  "./image.png"
                );
                await twitterClient.v2.tweet({
                  text: updated_post_content,
                  media: {
                    media_ids: [mediaId],
                  },
                });
              } catch (e) {
                console.log(e);
              }
            });
          };

          // Post Insta Implementation
          const postToInsta = async () => {
            const ig = new IgApiClient();
            ig.state.generateDevice(IG_USERNAME);
            await ig.account.login(IG_USERNAME, IG_PASSWORD);
            const imagePost_here = await get({
              url: image_post_uri,
              encoding: null,
            });
            const caption = updated_post_content;
            const media = await ig.publish.photo({
              file: imagePost_here,
              caption: caption,
            });
            console.log("Media:", media.status);
          };

          // Facebook Api Intaregation
          const PostToFacebook = async () => {
            try {
              console.log("ddddddddddddddddddddddddddddddddddddddddd");
              console.log(facebook_page_id, facebook_access_token);
              const response = await axios.post(
                `https://graph.facebook.com/${facebook_page_id}/photos?url=${image_post_uri}?&message=${updated_post_content}&access_token=${facebook_access_token}`
              );

              console.log(response);
            } catch (error) {
              console.log(error.message);
            }
          };

          // if (updated_social_media_array.includes("twitter")) {
          //   console.log("Twitter function call ");
          //   await tweet();
          // }

          // if (updated_social_media_array.includes("facebook")) {
          //   console.log("function Call Facebook");
          //   await PostToFacebook();
          // }

          // if (updated_social_media_array.includes("instagram")) {
          //   console.log("function Call insta");
          //   await postToInsta();
          // }

          try {
            if (updated_social_media_array.includes("twitter")) {
              console.log("Twitter function call ");
              await tweet();
            }
          } catch (error) {
            console.error("Error in Twitter function:", error);
          }

          try {
            if (updated_social_media_array.includes("facebook")) {
              console.log("function Call Facebook");
              await PostToFacebook();
            }
          } catch (error) {
            console.error("Error in Facebook function:", error);
          }

          try {
            if (updated_social_media_array.includes("instagram")) {
              console.log("function Call insta");
              await postToInsta();
            }
          } catch (error) {
            console.error("Error in Instagram function:", error);
          }
        } catch (error) {
          console.error("Error executing cron job:", error);
        } finally {
          cronJob.stop();
        }
      });

      cronJob.start();

      return res.status(200).json({ message: `Schedule Post SuccessFully` });
    } catch (error) {
      console.error("Error in API endpoint:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get All Posts
app.post("/backend/api/get-scheduled-posts", async (req, res) => {
  try {
    const { email } = req.body;

    const query = "SELECT * FROM scheduled_posts WHERE email = $1";
    const result = await pool.query(query, [email]);

    res.status(200).json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

//get Data by id
app.get("/backend/api/get-scheduled-post/:id", async (req, res) => {
  try {
    const postId = req.params.id;
    const query = "SELECT * FROM scheduled_posts WHERE id = $1";
    const values = [postId];
    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }

    // Return the data as JSON
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// edit schedule post
app.put(
  "/backend/api/edit-scheduled-post/:id",
  upload.fields([{ name: "imagePost", maxCount: 1 }]),
  async (req, res) => {
    try {
      const postId = req.params.id;
      const { social_media_array, email, post_content } = req.body;
      const socialMediaArray = JSON.parse(social_media_array);
      const schedule_time = dayjs(req.body.schedule_time);

      if (!schedule_time.isValid()) {
        return res.status(400).json({ error: "Invalid schedule_time format" });
      }

      if (!req.files["imagePost"] || !req.files["imagePost"][0]) {
        return res.status(400).json({ error: "Image file not provided" });
      }
      const imageFile = req.files["imagePost"][0];
      const imageBuffer = imageFile.buffer;
      const imageFilename = `${Date.now()}-${Math.floor(
        Math.random() * 1000
      )}.png`;

      const imagePath = path.join(__dirname, "uploads", imageFilename);
      fs.writeFileSync(imagePath, imageBuffer);

      let imageUrl = `${process.env.BACKEND_BASE_URL}/uploads/${imageFilename}`;

      const inputTime = schedule_time.format();
      const convertedTime = dayjs(inputTime).toISOString();
      console.log(convertedTime, "convertedTime");

      if (!schedule_time.isValid()) {
        return res.status(400).json({ error: "Invalid schedule_time format" });
      }

      const updateQuery = `
            UPDATE scheduled_posts
            SET social_media_array = $1, schedule_time = $2, image_post = $3, post_content = $4, email = $5 WHERE id = $6
        `;

      const values = [
        socialMediaArray,
        schedule_time.toISOString(),
        imageUrl,
        post_content,
        email,
        postId,
      ];

      await pool.query(updateQuery, values);

      res.status(200).json({ message: "Update successful" });
    } catch (error) {
      console.log(error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// delete schedule post
app.delete("/backend/api/delete-scheduled-post/:id", async (req, res) => {
  try {
    const postId = req.params.id;

    // Delete the scheduled post from the scheduled_posts table
    const deleteQuery = `
            DELETE FROM scheduled_posts
            WHERE id = $1
        `;

    const values = [postId];
    await pool.query(deleteQuery, values);
    console.log("delete successssss");
    res.status(200).json({ message: "Delete successful" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Twitter Data API
app.post("/backend/api/add-twitter-data", async (req, res) => {
  try {
    const {
      email,
      TWITTER_API_KEY,
      TWITTER_API_SECRET,
      TWITTER_ACCESS_TOKEN,
      TWITTER_ACCESS_SECRET,
      TWITTER_BEARER_TOKEN,
      TWITTER_APP_ID,
    } = req.body;

    // Validate required fields
    if (
      !email ||
      !TWITTER_API_KEY ||
      !TWITTER_API_SECRET ||
      !TWITTER_ACCESS_TOKEN ||
      !TWITTER_ACCESS_SECRET ||
      !TWITTER_BEARER_TOKEN ||
      !TWITTER_APP_ID
    ) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // Check if the email already exists in the database
    const checkEmailQuery = `
            SELECT * FROM users
            WHERE email = $1
        `;
    const emailCheckResult = await pool.query(checkEmailQuery, [email]);

    if (emailCheckResult.rows.length > 0) {
      // If the email exists, update the existing document
      const updateQuery = `
                UPDATE users
                SET TWITTER_API_KEY = $2, TWITTER_API_SECRET = $3,
                TWITTER_ACCESS_TOKEN = $4, TWITTER_ACCESS_SECRET = $5, TWITTER_BEARER_TOKEN = $6, TWITTER_APP_ID = $7
                WHERE email = $1
            `;

      const updateValues = [
        email,
        TWITTER_API_KEY,
        TWITTER_API_SECRET,
        TWITTER_ACCESS_TOKEN,
        TWITTER_ACCESS_SECRET,
        TWITTER_BEARER_TOKEN,
        TWITTER_APP_ID,
      ];
      await pool.query(updateQuery, updateValues);

      res.status(200).json({ message: "Twitter data updated successfully" });
    } else {
      // If the email doesn't exist, insert a new document
      const insertQuery = `
                INSERT INTO users (email, TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET, TWITTER_BEARER_TOKEN, TWITTER_APP_ID)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `;

      const insertValues = [
        email,
        TWITTER_API_KEY,
        TWITTER_API_SECRET,
        TWITTER_ACCESS_TOKEN,
        TWITTER_ACCESS_SECRET,
        TWITTER_BEARER_TOKEN,
        TWITTER_APP_ID,
      ];
      await pool.query(insertQuery, insertValues);

      res.status(200).json({ message: "Twitter data added successfully" });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Edit Twitter Data
app.put("/backend/api/edit-twitter-data", async (req, res) => {
  try {
    const {
      email,
      TWITTER_API_KEY,
      TWITTER_API_SECRET,
      TWITTER_ACCESS_TOKEN,
      TWITTER_ACCESS_SECRET,
      TWITTER_BEARER_TOKEN,
      TWITTER_APP_ID,
    } = req.body;

    // Check if the email exists in the database
    const checkEmailQuery = `
            SELECT * FROM users
            WHERE email = $1
        `;
    const emailCheckResult = await pool.query(checkEmailQuery, [email]);

    if (emailCheckResult.rows.length > 0) {
      // If the email exists, update the existing document
      const updateQuery = `
                UPDATE users
                SET TWITTER_API_KEY = $2, TWITTER_API_SECRET = $3,
                TWITTER_ACCESS_TOKEN = $4, TWITTER_ACCESS_SECRET = $5, TWITTER_BEARER_TOKEN = $6, TWITTER_APP_ID = $7
                WHERE email = $1
            `;

      const updateValues = [
        email,
        TWITTER_API_KEY,
        TWITTER_API_SECRET,
        TWITTER_ACCESS_TOKEN,
        TWITTER_ACCESS_SECRET,
        TWITTER_BEARER_TOKEN,
        TWITTER_APP_ID,
      ];
      await pool.query(updateQuery, updateValues);

      res.status(200).json({ message: "Twitter data updated successfully" });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Add Instagram Details
app.post("/backend/api/add-instagram-data", async (req, res) => {
  const { email, instagram_username, ig_password } = req.body;
  try {
    // Check if the email exists in the database
    const userExistsQuery = "SELECT * FROM users WHERE email = $1";
    const userExistsResult = await pool.query(userExistsQuery, [email]);

    if (userExistsResult.rows.length === 0) {
      return res.status(404).json({ error: "Email not found" });
    }

    const updateUserQuery =
      "UPDATE users SET instagram_username = $1, ig_password = $2 WHERE email = $3";
    await pool.query(updateUserQuery, [instagram_username, ig_password, email]);

    console.log("Instagram details updated successfully:", {
      email,
      instagram_username,
      ig_password,
    });
    res
      .status(200)
      .json({ message: "Instagram details submitted successfully" });
  } catch (error) {
    console.error("Error updating Instagram details:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

//Edit Instagram Data
app.put("/backend/api/edit-instagram-data", async (req, res) => {
  const { email, instagram_username, ig_password } = req.body;
  try {
    // Check if the email exists in the database
    const userExistsQuery = "SELECT * FROM users WHERE email = $1";
    const userExistsResult = await pool.query(userExistsQuery, [email]);

    if (userExistsResult.rows.length === 0) {
      return res.status(404).json({ error: "Email not found" });
    }

    const updateInstagramDetailsQuery =
      "UPDATE users SET instagram_username = $1, ig_password = $2 WHERE email = $3";
    await pool.query(updateInstagramDetailsQuery, [
      instagram_username,
      ig_password,
      email,
    ]);

    console.log("Instagram details updated successfully:", {
      email,
      instagram_username,
      ig_password,
    });
    res.status(200).json({ message: "Instagram details updated successfully" });
  } catch (error) {
    console.error("Error updating Instagram details:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Add Facebook Data
app.post("/backend/api/add-facebook-data", async (req, res) => {
  const { email, facebook_page_id, facebook_access_token } = req.body;
  try {
    const userExistsQuery = "SELECT * FROM users WHERE email = $1";
    const userExistsResult = await pool.query(userExistsQuery, [email]);

    if (userExistsResult.rows.length === 0) {
      return res.status(404).json({ error: "Email not found" });
    }
    const tokenExpiryTime = new Date();
    tokenExpiryTime.setHours(tokenExpiryTime.getHours() + 1);

    const indiaTimeZone = "Asia/Kolkata";
    const formattedExpiryTime = tokenExpiryTime.toLocaleString("en-US", {
      timeZone: indiaTimeZone,
    });

    const updateUserQuery =
      "UPDATE users SET facebook_page_id = $1, facebook_access_token = $2, facebook_token_expiry_time = $3 WHERE email = $4";

    await pool.query(updateUserQuery, [
      facebook_page_id,
      facebook_access_token,
      formattedExpiryTime,
      email,
    ]);

    console.log("Facebook details updated successfully:", {
      email,
      facebook_page_id,
      facebook_access_token,
      facebook_token_expiry_time: formattedExpiryTime,
    });

    return res
      .status(200)
      .json({ message: "Facebook details submitted successfully" });
  } catch (error) {
    console.error("Error updating Facebook details:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

//Edit Facebook Data
app.put("/backend/api/edit-facebook-data", async (req, res) => {
  const { email, facebook_page_id, facebook_access_token } = req.body;
  try {
    const userExistsQuery = "SELECT * FROM users WHERE email = $1";
    const userExistsResult = await pool.query(userExistsQuery, [email]);

    if (userExistsResult.rows.length === 0) {
      return res.status(404).json({ error: "Email not found" });
    }

    // Calculate the new expiry time in India time zone (current time + 1 hour)
    const newExpiryTime = new Date();
    newExpiryTime.setHours(newExpiryTime.getHours() + 1);

    // Convert the date to India time zone
    const indiaTimeZone = "Asia/Kolkata";
    const formattedExpiryTime = newExpiryTime.toLocaleString("en-US", {
      timeZone: indiaTimeZone,
    });

    const updateFacebookDetailsQuery =
      "UPDATE users SET facebook_page_id = $1, facebook_access_token = $2, facebook_token_expiry_time = $3 WHERE email = $4";

    await pool.query(updateFacebookDetailsQuery, [
      facebook_page_id,
      facebook_access_token,
      formattedExpiryTime,
      email,
    ]);

    console.log("Facebook details updated successfully:", {
      email,
      facebook_page_id,
      facebook_access_token,
      facebook_token_expiry_time: formattedExpiryTime,
    });
    return res
      .status(200)
      .json({ message: "Facebook details updated successfully" });
  } catch (error) {
    console.error("Error updating Facebook details:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// API endpoint to get all users
app.get("/backend/api/users", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM users");
    const users = result.rows;
    res.json(users);
  } catch (error) {
    console.error("Error fetching users:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// API endpoint to delete a user by ID
app.delete("/backend/api/delete-user/:id", async (req, res) => {
  try {
    const userId = req.params.id;

    // Check if the user exists before deleting
    const checkUserQuery = "SELECT * FROM users WHERE id = $1";
    const checkUserResult = await pool.query(checkUserQuery, [userId]);

    if (checkUserResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    // Delete the user from the users table
    const deleteUserQuery = "DELETE FROM users WHERE id = $1";
    await pool.query(deleteUserQuery, [userId]);

    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get User Data By Email
app.post("/backend/api/get-details-by-email/", async (req, res) => {
  try {
    const { email } = req.body;

    // Check if the email exists in the database
    const getUserQuery = `
            SELECT * FROM users
            WHERE email = $1
        `;
    const userResult = await pool.query(getUserQuery, [email]);

    if (userResult.rows.length > 0) {
      const userData = userResult.rows[0];
      res.status(200).json(userData);
    } else {
      res.status(404).json({ error: "User not found" });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const archiver = require("archiver");
const rimraf = require("rimraf");

// Get the current working directory
const currentDirectory = process.cwd();
console.log(currentDirectory, "currentDirectory");

// Function to create a ZIP archive of selected files and folders
function createZipArchive(sourceDir, destinationFile, selectedItems) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destinationFile);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      resolve();
    });

    archive.on("error", (err) => {
      reject(err);
    });

    archive.pipe(output);

    selectedItems.forEach((item) => {
      const itemPath = path.join(sourceDir, item);
      if (fs.existsSync(itemPath)) {
        if (fs.lstatSync(itemPath).isDirectory()) {
          archive.directory(itemPath, item);
        } else {
          // Add selected file to the ZIP
          archive.file(itemPath, { name: item });
        }
      }
    });

    archive.finalize();
  });
}

// Function to delete selected files and folders
function deleteSelectedItems(directory, selectedItems) {
  selectedItems.forEach((item) => {
    console.log("funciton delete");
    const itemPath = path.join(directory, item);
    if (fs.existsSync(itemPath)) {
      if (fs.lstatSync(itemPath).isDirectory()) {
        rimraf.sync(itemPath);
      } else {
        fs.unlinkSync(itemPath);
      }
    }
  });
}

app.get("/backend/api/test/backup/delete", (req, res) => {
  const items = fs.readdirSync(currentDirectory);
  const directories = items.filter((item) =>
    fs.lstatSync(path.join(currentDirectory, item)).isDirectory()
  );
  const files = items.filter((item) =>
    fs.lstatSync(path.join(currentDirectory, item)).isFile()
  );

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Download and Delete Directory</title>
    </head>
    <body>
        <h1>Download and Delete Directory</h1>
        <form method="post" action="/backend/api/test/backup/delete">
            <h2>Files and Folders:</h2>
            <ul>
                ${directories
                  .map(
                    (dir) =>
                      `<li><input type="checkbox" name="selected_items[]" value="${dir}">${dir}/</li>`
                  )
                  .join("")}
                ${files
                  .map(
                    (file) =>
                      `<li><input type="checkbox" name="selected_items[]" value="${file}">${file}</li>`
                  )
                  .join("")}
            </ul>
            <input type="submit" name="download" value="Download Selected">
            <input type="submit" name="delete" value="Delete Selected">
        </form>
    </body>
    </html>
  `);
});

app.post("/backend/api/test/backup/delete", async (req, res) => {
  const selectedItems = req.body.selected_items || [];

  console.log("clall api ");
  console.log(req.body, "req body");
  console.log(selectedItems);
  if (req.body.download) {
    console.log("download zip");
    console.log(req.body.download);
    const zipFileName = "backup.zip";

    // Create a ZIP archive of the selected items
    try {
      await createZipArchive(currentDirectory, zipFileName, selectedItems);
      console.log("create zip");
      // Check if the ZIP file was successfully created
      if (fs.existsSync(zipFileName)) {
        // Download the ZIP file
        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${zipFileName}"`
        );
        const zipFileStream = fs.createReadStream(zipFileName);
        console.log("2 zip create");

        // Stream the ZIP file to the response
        zipFileStream.pipe(res);

        console.log("pipe zip");

        // Close the zipFileStream after streaming
        zipFileStream.on("end", () => {
          console.log("delte zip ");
          // Delete the ZIP file after download
          fs.unlinkSync(zipFileName);
        });

        return;
      } else {
        res.send("Failed to create ZIP archive.");
        return;
      }
    } catch (error) {
      res.send("Failed to create ZIP archive.");
      return;
    }
  }

  // Check if the user clicked the "Delete Selected" button
  if (req.body.delete) {
    console.log("delete Here");
    console.log(req.body.delete);
    deleteSelectedItems(currentDirectory, selectedItems);
  }

  res.redirect("/backend/api/test/backup/delete");
});

//__________________________________________________________________________________________//

app.get(
  "/backend/api/auth/facebook",
  passport.authenticate("facebook", {
    scope: [
      "email",
      "page_events",
      "pages_manage_engagement",
      "pages_manage_posts",
      "pages_manage_ads",
      "ads_management",
      "ads_read",
      "business_management",
      "pages_manage_ads",
      "pages_manage_cta",
      "pages_manage_metadata",
      "pages_manage_instant_articles",
      "pages_read_engagement",
      "pages_show_list",
      "read_page_mailboxes",
    ],
  }),
  (req, res) => {
    console.log("autho call ");
  }
);

app.get(
  "backend/api/auth/facebook/callback",
  passport.authenticate("facebook", {
    successRedirect: "/",
    failureRedirect: "/login",
  }),
  function (req, res) {
    res.redirect("/");
  }
);

app.post("/postToPage", async function (req, res) {
  const message = "hello";
  const userAccessToken = req.user._json.accounts.data[0].access_token;
  const userFirstPageId = req.user && req.user._json.id;
  if (!userAccessToken || !userFirstPageId || !message) {
    console.log("invaided");
    return res.status(400).send("Invalid request parameters");
  }
  let image_post_uri =
    "http://192.227.234.133/backend/uploads/1707995366371-350.png?";

  const response = await axios.post(
    `https://graph.facebook.com/260902180432236/photos?url=${image_post_uri}&message=${message}&access_token=${userAccessToken}`
  );

  console.log(response.data);
});

// Twitter APis ________+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// app.get("/backend/api/auth/twitter", passport.authenticate("twitter"));

// // Twitter will redirect the user to this URL after approval
// app.get(
//   "/backend/api/auth/twitter/callback",
//   passport.authenticate("twitter", { failureRedirect: "/" }),
//   function (req, res) {
//     console.log("success");
//     res.redirect("/profile");
//   }
// );

const CLIENT_URL = "http://localhost:3000/";

app.get("/backend/api/auth/twitter", passport.authenticate("twitter"));

app.get(
  "/backend/api/auth/twitter/callback",
  passport.authenticate("twitter", {
    successRedirect: CLIENT_URL,
    failureRedirect: "/login/failed",
  })
);

app.get("/backend/api/amit", (req, res) => {
  res.send("Hello Amit");
});

