// index.js
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow;
// 📌 접속 도메인을 erptest.shop으로 변경 (HTTPS 권장, 필요시 http로 수정)
let SERVER_URL = "https://erptest.shop"; 

function loadConfig() {
    try {
        const userDataPath = app.getPath("userData");
        const configPath = path.join(userDataPath, "config.json");

        if (!fs.existsSync(configPath)) {
            // 📌 기본 설정값 변경
            const defaultConfig = { serverUrl: "https://erptest.shop" };
            fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), "utf8");
        }

        const rawData = fs.readFileSync(configPath, "utf8");
        const config = JSON.parse(rawData);
        if (config.serverUrl) {
            SERVER_URL = config.serverUrl;
            console.log("[Main] 외부 config.json 로드 완료 - SERVER_URL:", SERVER_URL);
        }
    } catch (error) {
        console.error("[Main] config.json 읽기 실패:", error);
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        backgroundColor: "#f5f7fa",
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
    loadConfig();
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

// config 정보 전달
ipcMain.handle("get-config", () => {
    return { serverUrl: SERVER_URL };
});

// 이하 통신 API 코드는 기존과 동일하게 유지됩니다.
ipcMain.handle("load-data", async () => {
    try {
        const response = await fetch(`${SERVER_URL}/api/data`);
        if (!response.ok) throw new Error("서버 응답 오류");
        return await response.json();
    } catch (error) {
        console.error("[Main] 데이터 불러오기 실패:", error);
        return null;
    }
});

ipcMain.handle("save-data", async (event, data) => {
    try {
        const response = await fetch(`${SERVER_URL}/api/data`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error("서버 저장 오류");
        return await response.json();
    } catch (error) {
        console.error("[Main] 데이터 저장 실패:", error);
        return false;
    }
});

ipcMain.handle("login", async (event, credentials) => {
    try {
        const response = await fetch(`${SERVER_URL}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(credentials)
        });
        return await response.json();
    } catch (error) {
        console.error("[Main] 로그인 통신 실패:", error);
        return { success: false, message: "서버에 연결할 수 없습니다." };
    }
});

ipcMain.handle("change-password", async (event, payload) => {
    try {
        const response = await fetch(`${SERVER_URL}/api/change-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        return await response.json();
    } catch (error) {
        console.error("[Main] 비밀번호 변경 통신 실패:", error);
        return { success: false, message: "서버에 연결할 수 없습니다." };
    }
});

ipcMain.handle("toggle-fullscreen", () => {
    if (!mainWindow) return false;
    const nextState = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(nextState);
    return nextState;
});

ipcMain.handle("log-activity", async (event, message) => {
    try {
        await fetch(`${SERVER_URL}/api/log`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message })
        });
    } catch (error) {
        console.error("[Main] 로그 전송 실패:", error);
    }
});