import "./settings/config.js";
import { qtext, metaai, qloc, qvideo, qpay, qpoll } from "./source/qouted.js"; 
import fs from "fs";
import path from "path";
import chalk from "chalk";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pluginCache = new Map(); 
const aliasMap = new Map();    
const regexPlugins = []; 
const cooldowns = new Map();

const fakeQuotes = [qtext, metaai, qloc, qvideo, qpay, qpoll];
const getRandomQuote = () => fakeQuotes[Math.floor(Math.random() * fakeQuotes.length)];

const log = {
    cmd: (cmd, user, group) => console.log(`${chalk.bgHex('#FF4500').bold(' EXEC ')} ${chalk.greenBright(cmd)} by ${chalk.yellow(user)} ${chalk.gray(group ? '[GRP]' : '[PRV]')}`),
    error: (msg) => console.log(`${chalk.red.bold(' [!] ')} ${msg}`),
    warn: (msg) => console.log(`${chalk.yellow.bold(' [?] ')} ${msg}`),
    sys: (msg) => console.log(`${chalk.cyanBright(' [*] ')} ${msg}`)
};

const cacheBustImport = async (absPath) => {
    try {
        const url = `${pathToFileURL(absPath).href}?v=${Date.now()}`;
        return await import(url);
    } catch (e) {
        log.error(`Gagal import: ${path.basename(absPath)} -> ${e.message}`);
        return null;
    }
};

export const pluginsLoader = async (directory) => {
    const targetDir = directory || path.resolve(__dirname, "./cmd");
    
    if (!fs.existsSync(targetDir)) {
        log.sys(`Membuat Folder: ${path.basename(targetDir)}`);
        fs.mkdirSync(targetDir, { recursive: true });
    }

    const scanPlugins = (dir) => {
        let files = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) files = [...files, ...scanPlugins(fullPath)];
            else if (entry.isFile() && entry.name.endsWith(".js")) files.push(fullPath);
        }
        return files;
    };

    const files = scanPlugins(targetDir);
    
    pluginCache.clear();
    aliasMap.clear();
    regexPlugins.length = 0;

    let successCount = 0;

    for (const file of files) {
        const module = await cacheBustImport(file);
        if (module?.default) {
            const plugin = module.default;
            const filename = path.basename(file);
            
            plugin.filename = filename;
            plugin.path = file;

            pluginCache.set(filename, plugin);

            if (plugin.command) {
                const commands = Array.isArray(plugin.command) ? plugin.command : [plugin.command];
                commands.forEach(cmd => {
                    if (typeof cmd === 'string') aliasMap.set(cmd.toLowerCase(), plugin);
                    else if (cmd instanceof RegExp) regexPlugins.push({ reg: cmd, plugin });
                });
                successCount++;
            }
        }
    }
    
    log.sys(`Plugin Aktif: ${successCount} Berhasil Dimuat.`);

    return Array.from(pluginCache.values());
};

export const runPlugins = async (m, ctx) => {
    if (!ctx || !ctx.command) return false;
    
    const cmdUser = ctx.command.toLowerCase();
    const sender = ctx.sender || m.sender || "";
    const senderNumber = sender.split("@")[0];

    let plugin = aliasMap.get(cmdUser);
    if (!plugin && regexPlugins.length > 0) {
        const found = regexPlugins.find(item => item.reg.test(cmdUser));
        if (found) plugin = found.plugin;
    }
    
    if (!plugin) return false; 

    const now = Date.now();
    const cooldownAmount = (plugin.cooldown || 3) * 1000;
    if (cooldowns.has(sender)) {
        const expirationTime = cooldowns.get(sender) + cooldownAmount;
        if (now < expirationTime) {
            const timeLeft = ((expirationTime - now) / 1000).toFixed(1);
            return await m.reply(`[ WAIT ] Lu lagi cooldown, tunggu ${timeLeft} detik lagi.`);
        }
    }
    cooldowns.set(sender, now);

    if (plugin.owner && !global.owner.includes(senderNumber)) return await m.reply(global.mess.owner);
    if (plugin.group && !m.isGroup) return await m.reply(global.mess.group);
    if (plugin.admin && !ctx.isAdmin) return await m.reply(global.mess.admin);
    if (plugin.botAdmin && !ctx.isBotAdmin) return await m.reply(global.mess.botadmin);

    try {
        log.cmd(cmdUser, senderNumber, m.isGroup);
        await plugin(m, ctx, { 
            quoted: getRandomQuote(),
            plugins: pluginCache,
            log: log
        });
        return true;
    } catch (error) {
        log.error(`Terjadi Kerusakan Di ${plugin.filename}: ${error.message}`);
        const report = `[ ERROR REPORT ]\n\n- Plugin: ${plugin.filename}\n- Cmd: ${cmdUser}\n- Info: ${error.message}`;
        await m.reply(report);
        return true;
    }
};

const startWatcher = () => {
    const cmdDir = path.resolve(__dirname, "./cmd");
    if (!fs.existsSync(cmdDir)) return;

    log.sys(`Pemantauan Aktif Pada Folder: /cmd/`);

    fs.watch(cmdDir, { recursive: true }, async (eventType, filename) => {
        if (!filename?.endsWith('.js')) return;
        
        if (global.isReloading) return;
        global.isReloading = true;

        log.sys(`Perubahan Terdeteksi: ${filename} (${eventType})`);
        
        await pluginsLoader(cmdDir);
        
        setTimeout(() => { global.isReloading = false; }, 1000);
    });
};

// -- [ Init ] --
(async () => {
    await pluginsLoader();
    startWatcher();
})();
