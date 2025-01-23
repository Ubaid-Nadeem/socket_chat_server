import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import mongoose, { Schema } from "mongoose";
import bcrypt from "bcrypt";
import "dotenv/config";
import multer from "multer";

const userSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
});

const messageSchema = new Schema({
  message: String,
  senderId: String,
  senderName: String,
  reciverId: String,
  image: { type: Schema.Types.ObjectId, ref: "UploadImage" },
});

const fileSchema = new Schema({
  fileName: String,
  buffer: Buffer,
});

const User = mongoose.model("ChatappUser", userSchema);
const Message = mongoose.model("Chatappmsg", messageSchema);
const FileUpload = mongoose.model("UploadImage", fileSchema);

const userIds = {};

const app = express();
app.use(express.json());

app.use(cors("*"));

const storage = multer.memoryStorage();
const upload = multer({ storage });

await mongoose
  .connect(process.env.MONOGO_DB_KEY)
  .then(() => {
    console.log("db connected");
  })
  .catch((e) => {
    console.log(e);
  });

const appServer = http.createServer(app);

const io = new Server(appServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  socket.on("connected_user", async (user) => {
    if (!user) return;

    userIds[user.user._id] = socket.id;

    let allUsers = await User.find({
      _id: { $ne: user.user._id },
    }).select("-password");

    io.to(socket.id).emit("all_users", { allUsers });
  });

  socket.on("new_message", async (data) => {
    let { reciverId, senderId, message, image } = data;
    let reciver = userIds[data.reciverId];

    let newMessage = new Message({
      reciverId,
      senderId,
      message,
    });

    try {
      await newMessage.save();
      io.to(reciver).emit("new_message", data);
    } catch (e) {
      console.log(e);
    }
  });

  socket.on("fetch_Prev_Chat", async ({ reciverId, senderId }) => {
    let prevMessages = await Message.find({
      $or: [
        {
          reciverId: reciverId,
          senderId: senderId,
        },
        {
          reciverId: senderId,
          senderId: reciverId,
        },
      ],
    }).populate("image");

    const targetSocket = userIds[senderId];

    io.to(targetSocket).emit("send_message", {
      messages: prevMessages,
    });

    // prevMessages.forEach(({ message, senderId, reciverId, image }) => {
    //   io.to(targetSocket).emit("send_message", {
    //     message,
    //     senderId,
    //     reciverId,
    //     image,
    //   });
    // });
  });

  socket.on("disconnect", () => {
    console.log(`User disconned with socket id: ${socket.id}`);
    let [key] = Object.keys(userIds).filter(
      (key) => userIds[key] === socket.id
    );
    delete userIds[key];
  });
});

app.get('/', (req, res) => {
  res.send('Hello, Vercel!');
  console.log("Hello Vercel!")
});

app.post("/signup", async (req, res) => {
  const { email, password, name } = req.body;
  const newUser = new User({ email, password, name });
  try {
    const user = await newUser.save();
    res.send({
      data: newUser,
      error: false,
      msg: "User created sucessfully",
    });
  } catch (e) {
    if (e.keyValue.email) {
      res.json({
        data: null,
        error: true,
        msg: "Email already in use.",
      });
    }
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  let [findUser] = await User.find({ email });

  if (findUser) {
    if (findUser.password === password) {
      let cloneUser = findUser.toObject();
      delete cloneUser.password;

      res.send({
        data: cloneUser,
        error: false,
        msg: "Logged in sucessfully",
      });
    } else {
      res.send({
        data: null,
        error: true,
        msg: "Inccorect Password",
      });
    }
  } else {
    res.send({
      data: null,
      error: true,
      msg: "User not found",
    });
  }
});

app.post("/uploadimage", upload.single("file"), async (req, res) => {
  let data = JSON.parse(req.body.message);
  let file = req.file;

  let newFile = new FileUpload({
    buffer: file.buffer,
    fileName: file.originalname,
  });

  const getFile = await newFile.save();
  let { reciverId } = data;
  let newMessage = new Message({ ...data, image: getFile._id });

  const targetSocket = userIds[reciverId];

  try {
    let getMessage = await newMessage.save();
    let d = await getMessage.populate("image");
    io.to(targetSocket).emit("new_message", d);
    res.send(d);
  } catch (e) {
    console.log(e);
  }
});

appServer.listen(process.env.PORT || 4000, () => {
  console.log("Server is running");
});
