var express = require("express");
var router = express.Router();
const mongoose = require("mongoose");

const messageModel = require("../schemas/messages");
const { checkLogin } = require("../utils/authHandler");
const { uploadImage } = require("../utils/uploadHandler");

function optionalFileUpload(req, res, next) {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    return next();
  }
  uploadImage.single("file")(req, res, function (err) {
    if (err) {
      return res.status(400).send({ message: err.message });
    }
    next();
  });
}

// Fetch last message for each conversation involving the current user
router.get("/", checkLogin, async function (req, res) {
  try {
    const currentUserId = new mongoose.Types.ObjectId(req.user._id);

    const conversations = await messageModel.aggregate([
      {
        $match: {
          $or: [{ from: currentUserId }, { to: currentUserId }]
        }
      },
      { $sort: { createdAt: -1 } },
      {
        $addFields: {
          otherUser: {
            $cond: [{ $eq: ["$from", currentUserId] }, "$to", "$from"]
          }
        }
      },
      {
        $group: {
          _id: "$otherUser",
          lastMessage: { $first: "$$ROOT" }
        }
      },
      { $replaceRoot: { newRoot: "$lastMessage" } }
    ]);

    const populated = await messageModel.populate(conversations, [
      { path: "from", select: "username fullName avatarUrl" },
      { path: "to", select: "username fullName avatarUrl" }
    ]);

    res.send(populated);
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});

// Fetch the conversation between the logged-in user and the target user
router.get("/:userID", checkLogin, async function (req, res) {
  try {
    const { userID } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userID)) {
      return res.status(400).send({ message: "invalid userID" });
    }

    const currentUserId = req.user._id;
    const messages = await messageModel
      .find({
        $or: [
          { from: currentUserId, to: userID },
          { from: userID, to: currentUserId }
        ]
      })
      .sort({ createdAt: 1 })
      .populate("from to", "username fullName avatarUrl");

    res.send(messages);
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});

router.post("/:userID", checkLogin, optionalFileUpload, async function (req, res) {
  try {
    const { userID } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userID)) {
      return res.status(400).send({ message: "invalid userID" });
    }

    const currentUserId = req.user._id;
    const payload = {
      from: currentUserId,
      to: userID,
      messageContent: {}
    };

    if (req.file) {
      payload.messageContent = {
        type: "file",
        text: (req.file.path || "").replace(/\\/g, "/")
      };
    } else {
      const textContent = (req.body.text || "").trim();
      if (!textContent) {
        return res.status(400).send({ message: "text is required" });
      }
      payload.messageContent = {
        type: "text",
        text: textContent
      };
    }

    const newMessage = await messageModel.create(payload);
    await newMessage.populate("from to", "username fullName avatarUrl");

    res.status(201).send(newMessage);
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});

module.exports = router;
