const axios = require("axios");
const chalk = require("chalk");
const login = require("fca-unofficial");
const package = require("./package.json");
const totp = require("totp-generator");
const ytdl = require("ytdl-core");
const { writeFileSync, createReadStream, unlinkSync, createWriteStream } = require("fs-extra");
var { data: botData } = package;

const BigData = {
    logEvent: false,
    isProcess: false,
    reaction: new Map(),
    reply: new Map(),
    threadData: {},
    userData: {},
    default: botData.default,
    event: { id: '', messageID: '' }
};

const Data = {
    loginCookieOptions: {
        forceLogin: true,
        listenEvents: true,
        logLevel: "error",
        updatePresence: true,
        selfListen: true,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36"
    },
    loginEmailOptions: {
        logLevel: "silent",
        forceLogin: true,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36"
    }
}

const modules = {
    logger: function (data, option, more) {
        const color = more == 0 ? "greenBright" : more == 1 ? "redBright" : more == 2 ? "cyanBright" : more == 3 ? "magentaBright" : undefined;
        if (option == 0) return console.log(chalk.yellow(data));
        else if (option == undefined) return console.log(chalk.greenBright(`[ ${data.toUpperCase()} ] » `) + data);
        else return console.log(chalk[color == undefined ? "greenBright" : color](`[ ${option.toUpperCase()} ] » `) + `${data}`);
    },
    getName: function (api, id) {
        return new Promise(async (resolve) => {
            if (botData.users.some(i => i.userID == id)) {
                resolve(botData.users.find(e => e.userID == id).name);
            } else if (!botData.users.some(i => i.userID == id)) {
                var name = (await api.getUserInfo(id))[id];
                resolve(name)
            } else {
                resolve('');
            }
        });
    },
    checkUpdate: async function () {
        try {            
            const { data } = await axios.get("https://raw.githubusercontent.com/ProCoderMew/OneFile/main/package.json");
            if (data.version != package.version) {
                modules.logger("Đã có bản cập nhật mới.", "update");
            }
        } catch {
            modules.logger("Đã có lỗi xảy ra.", "update");
        }
    },
    loginWithEmail: function () {
        return login({ email: botData.default.email, password: botData.default.password }, Data.loginEmailOptions, (err, api) => {
            if (err) {
                switch (err.error) {
                    case "login-approval":
                        err.continue(totp(botData.default.token));
                        break;
                    default:
                        console.error(err.error);
                        process.exit();
                        break;
                }
                return;
            }
            botData.cookies = api.getAppState();
            writeFileSync("./package.json", JSON.stringify(package, null, 4));
            modules.logger("Đã ghi thành công cookie mới.", "cookie");
            return modules.loginWithCookie();
        });
    },
    loginWithCookie: function () {
        require("npmlog").emitLog = () => { };
        modules.checkUpdate();
        return login({ appState: botData.cookies }, function (err, api) {
            if (err) {
                if (err.error == "Not logged in" || err.error.indexOf("Error retrieving userID.") == 0) return modules.loginWithEmail();
                else return modules.logger(err, "login", 1);
            }
            botData.cookies = api.getAppState();
            writeFileSync("./package.json", JSON.stringify(package, null, 4));
            api.setOptions(Data.loginCookieOptions);
            modules.loadData();
            modules.logger("Bot ID: " + api.getCurrentUserID(), "info");
            modules.logger("Bắt đầu nhận tin.", "status");
            const listen = modules.listen({ api });
            const temp = ["presence", "typ", "read_receipt"];
            const handleListen = function (error, event) {
                if (error) return modules.logger(error.error, "listen", 1);
                if (temp.includes(event.type)) return;                
                if (BigData.event.id == api.getCurrentUserID() &&
                    BigData.event.messageID == event.messageID) {
                    api.listenMqtt().stopListening();
                }
                listen(event);
                if (BigData.logEvent == true) console.log(event);
                BigData.event.id = event.senderID || '';
                BigData.event.messageID = event.messageID || '';
            };
            api.listenMqtt(handleListen);
            setInterval(async function () {
                api.listenMqtt().stopListening();
                await restart();
            }, 3600000);
            async function restart() {
                await new Promise(resolve => setTimeout(resolve, 20000));
                logger("Bắt đầu nhận tin.", "status");
                return api.listenMqtt(handleListen);
            };
        })
    },
    listen: function ({ api }) {
        return function (event) {
            switch (event.type) {
                case "message":
                case "message_reply":
                case "message_unsend":
                    Message({ api })({ event });
                    noPrefix({ api })({ event });
                    Reply({ api })({ event });
                    break;
                case "event":
                    switch (event.logMessageType) {
                        case "log:subscribe":
                            if (event.logMessageData.addedParticipants.some(i => i.userFbId == api.getCurrentUserID())) {
                                return api.sendMessage(`Đã kết nối thành công >w<`, event.threadID, () => {
                                    api.changeNickname(BigData.default.name, event.threadID, api.getCurrentUserID(), () => {
                                        api.muteThread(event.threadID, -1);
                                    });
                                });
                            }
                            break;
                    }
                    break;
            }
        }
    },
    createData: async function ({ event, api }) {
        var { senderID, threadID, isGroup } = event;
        threadID = parseInt(threadID);
        senderID = parseInt(senderID);
        if (!botData.hasOwnProperty('threads')) botData['threads'] = [];
        if (!botData.hasOwnProperty('users')) botData['users'] = [];
        let threads = botData.threads;
        let users = botData.users;
        if (!users.some(e => e.userID == senderID)) {
            var userData = (await api.getUserInfo(senderID))[senderID];
            let name = userData.name;
            let sex = userData.gender;
            users.push({ userID: senderID, name, sex, block: false });
            modules.loadData();
            modules.logger(senderID + " | " + name, "user", 2);
        }
        if (!threads.some(e => e.threadID == threadID) && isGroup) {
            let threadInfo = await api.getThreadInfo(threadID);
            threads.push({ threadID, name: threadInfo.name, prefix: BigData.default.prefix, block: false, selfListen: false, blockCmd: [], shortcuts: [] });
            modules.loadData();
            modules.logger(threadID + " | " + threadInfo.name, "thread", 2);
        }
        writeFileSync("./package.json", JSON.stringify(package, null, "\t"));
    },
    loadData: function () {
        if (botData.hasOwnProperty('threads')) {
            for (const thread of botData.threads) {
                if (!BigData.threadData.hasOwnProperty(thread.threadID)) {
                    BigData.threadData[thread.threadID] = thread;
                }
            }
        }
        if (botData.hasOwnProperty('users')) {
            for (const user of botData.users) {
                if (!BigData.userData.hasOwnProperty(user.userID)) {
                    BigData.userData[user.userID] = user;
                }
            }
        }
    },
    getData: function ({ event }) {
        var thread = botData.threads.find(e => e.threadID == event.threadID);
        var user = botData.users.find(e => e.userID == event.senderID);
        return {
            thread,
            user
        }
    }
}

function Message({ api }) {
    const botID = api.getCurrentUserID();
    return async function ({ event }) {
        const { threadID, senderID, messageID, body: content } = event;
        if (!event.isGroup) return;
        if ((Object.keys(BigData.threadData)).some(e => e == threadID) && BigData.threadData[threadID].block == true) return;
        if ((Object.keys(BigData.userData)).some(e => e == senderID) && BigData.userData[senderID].block == true) return;
        if (!Object.keys(BigData.threadData).some(e => e == threadID)) return modules.createData({ event, api });

        var out = function (data, callback = function () { }, mid) {
            if (!data) return;
            mid = typeof mid == "undefined" ? messageID : mid;
            typeof callback == "string" ? mid = callback : callback;
            typeof callback != "function" ? callback = function () { } : callback;
            return api.sendMessage(data, threadID, callback, mid);
        }

        // check admin
        var isAdmin = function () {
            var list = BigData.default.admin;
            if (list == senderID) return true;
            else {
                out("Bạn không đủ quyền sử dụng lệnh này.");
                return false;
            }
        }
        if (BigData.threadData[threadID].selfListen == false && api.getCurrentUserID() == senderID) return;
        var prefix = BigData.threadData[threadID].prefix || BigData.default.prefix;
        if (content.indexOf(prefix) !== 0) return;
        var args = content.slice(prefix.length).trim().split(/ +/);

        try {
            var { user: DataUser, thread: DataThread } = modules.getData({ event });
            //all
            if (args[0] == "all") {
                var threadData = await api.getThreadInfo(threadID);
                var all = threadData.participantIDs;
                var body = args.slice(1).join(" ") || '‎', mentions = [];
                all = all.filter(e => e != api.getCurrentUserID());
                for (let i in all) {
                    if (i == body.length) body += body.charAt(body.length - 1);
                    if (typeof body[i] != "undefined") mentions.push({ tag: body[i], id: all[i], fromIndex: i });
                }
                return out({ body, mentions });
            }

            // uid
            if (args[0] == "uid") {
                var msg = '';
                if (Object.keys(event.mentions).length == 0) return out(senderID);
                else {
                    for (let e of Object.keys(event.mentions)) {
                        msg += `\n${event.mentions[e].replace(/@/g, "")}: ${e}`
                    }
                    return out(msg);
                }
            }
            // uptime
            if (args[0] == "uptime") {
                var sec_num = parseInt(process.uptime(), 10);
                var days = Math.floor(sec_num / (3600 * 24))
                var hours = Math.floor(sec_num % (3600 * 24) / 3600);
                var minutes = Math.floor(sec_num / 60) % 60;
                var seconds = sec_num % 60;
                return out([days, hours, minutes, seconds].map(v => (v < 10 ? "0" + v : v)).filter((v, i) => v !== "00" || i > 0).join(":"));
            }
            // on/off log
            if (args[0] == "log" && isAdmin()) {
                if (BigData.logEvent == true) {
                    BigData.logEvent = false;
                    return out("Đã tắt log event.");
                } else {
                    BigData.logEvent = true;
                    return out("Đã bật log event.");
                }
            }
            // set prefix        
            if (args[0] == "setprefix" && isAdmin()) {
                if (!args[1]) return out("Prefix cần set where :D?");
                try {
                    BigData.threadData[threadID].prefix = args[1];
                    botData.threads.find(e => e.threadID == threadID).prefix = args[1];
                    writeFileSync("./package.json", JSON.stringify(package, null, 4));
                    return out("Đổi prefix thành công.");
                }
                catch {
                    return out("Đã có lỗi xảy ra.");
                }
            }

            // sing
            if (args[0] == "sing") {
                const regexYoutube = /^(https?:\/\/)?(www\.)?(m\.)?(youtube\.com|youtu\.?be)\/.+$/gi;
                if (regexYoutube.test(args[1])) {
                    var videoInfo = await ytdl.getInfo(args[1]);
                    var { videoId, lengthSeconds } = videoInfo.videoDetails;
                    if (lengthSeconds > 1200) return out("Độ dài video vượt quá mức cho phép, tối đa là 20 phút!");
                    else return api.sendTypingIndicator(threadID, () => ytdl(videoId, { filter: format => format.itag == '140' }).pipe(createWriteStream(`./${videoId}.m4a`)).on("close", () => out({ body: videoInfo.videoDetails.title, attachment: createReadStream(`./${videoId}.m4a`) }, () => unlinkSync(`./${videoId}.m4a`))));
                }
                else {
                    var msg = '', allId = [], num = 0;
                    try {
                        var retrieve = (await axios.get(`https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=5&key=${BigData.default.keys.youtube}&q=${encodeURIComponent(args.slice(1).join(" "))}`)).data.items;
                        for (var e in retrieve) {
                            allId.push(retrieve[e].id.videoId);
                            if (typeof retrieve[e].id.videoId != 'undefined') {
                                msg += `\n${num += 1} ❯ ${decodeURIComponent(retrieve[e].snippet.title)}`;
                            }
                        }
                        return out(`Chọn:${msg}`, (e, i) => BigData.reply.set(i.messageID, { name: args[0], replyData: allId, num }));
                    }
                    catch (e) {
                        out(`${e.name}: ${e.message}`);
                    }
                }
                return;
            }
            // rerun
            if (args[0] == "rerun") {
                if (event.type != "message_reply") return out("Vui lòng reply 1 tin nhắn");
                var PushEvent = {
                    type: 'message',
                    threadID: threadID,
                    messageID: event.messageReply.messageID,
                    senderID: senderID,
                    attachments: event.messageReply.attachments,
                    body: event.messageReply.body,
                    isGroup: true,
                    mentions: event.messageReply.mentions,
                    timestamp: Date.now()
                };
                try { modules.listen({ api })(PushEvent) } catch (e) { out(`${e}`) }
            }

            // selfListen
            if (args[0] == "sl") {
                if (BigData.threadData[threadID].selfListen == false) {
                    BigData.threadData[threadID].selfListen = true;
                    DataThread.selfListen = true;
                    out("Đã bật selfListen.");
                } else if (BigData.threadData[threadID].selfListen == true) {
                    BigData.threadData[threadID].selfListen = false;
                    DataThread.selfListen = false;
                    out("Đã tắt selfListen.");
                }
                writeFileSync("./package.json", JSON.stringify(package, null, 4))
            }

            //say
            if (args[0] == "say") {
                var dataSay = args.slice(1).join(" ");
                var name = Math.floor(Math.random() * 99999999999999999999999999999999);
                var { data } = await axios(`https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(dataSay)}&tl=vi&client=tw-ob`, { responseType: 'arraybuffer' });
                writeFileSync(`./${name}.mp3`, Buffer.from(data, 'utf-8'));
                return api.sendMessage({ attachment: createReadStream(`./${name}.mp3`)}, event.threadID, () => unlinkSync(`./${name}.mp3`));                
            }
        } catch (e) {
            out(`${e.name}: ${e.message} in cmd ${args[0]}`);
            modules.logger(`${e.name}: ${e.message} in cmd ${args[0]}`, "message", 1);
        }
    }
}

function Reply({ api }) {
    var replyData = [];
    return async function ({ event }) {
        const { threadID, messageID, senderID, body: content } = event;
        if (event.type != "message_reply") return;
        for (var e of BigData.reply.entries()) {
            if (!replyData.some(i => i == e[0])) replyData.push(e[0]);
        }

        var out = function (data, callback = function () { }, mid) {
            if (!data) return;
            mid = typeof mid == "undefined" ? messageID : mid;
            typeof callback == "string" ? mid = callback : callback;
            typeof callback != "function" ? callback = function () { } : callback;
            return api.sendMessage(data, threadID, callback, mid);
        }

        if (replyData.length > 0) {
            var DataInReplyData = BigData.reply.get(event.messageReply.messageID);
            if (typeof DataInReplyData == "undefined") return;
            const { name: commandName } = DataInReplyData;
            switch (commandName) {
                case "sing":
                    if (isNaN(content) || content < 1 || content > DataInReplyData.num) return out("Không tồn tại data");
                    api.unsendMessage(event.messageReply.messageID);
                    var videoInfo = await ytdl.getInfo(DataInReplyData.replyData[content - 1]);
                    var { lengthSeconds } = videoInfo.videoDetails;
                    if (lengthSeconds > 1200) return out("Độ dài video vượt quá mức cho phép, tối đa là 20 phút!");
                    else return api.sendTypingIndicator(threadID, () => ytdl(DataInReplyData.replyData[content - 1], { filter: format => format.itag == '140' }).pipe(createWriteStream(`./${DataInReplyData.replyData[content - 1]}.m4a`)).on("close", () => out({ attachment: createReadStream(`./${DataInReplyData.replyData[content - 1]}.m4a`) }, () => unlinkSync(`./${DataInReplyData.replyData[content - 1]}.m4a`))));
                break;
            }
        }
        BigData.reply.delete(event.messageReply.messageID);
        replyData.splice(replyData.indexOf(event.messageReply.messageID), 1);
    }
}

function noPrefix({ api }) {
    return async function ({ event }) {        
        const { threadID, senderID, messageID, body } = event;
        if (senderID == api.getCurrentUserID()) return;
        
        var out = function (data, callback = function () { }, mid) {
            if (!data) return;
            mid = typeof mid == "undefined" ? messageID : mid;
            typeof callback == "string" ? mid = callback : callback;
            typeof callback != "function" ? callback = function () { } : callback;
            return api.sendMessage(data, threadID, callback, mid);
        }

        if (body == "ahihi") return out("=))");
    }
}

// get cookie or start bot
if (!botData.hasOwnProperty('cookies') || botData.cookies.length == 0) {
    console.clear();
    return modules.loginWithEmail();
} else {
    console.clear();
    return modules.loginWithCookie();
}