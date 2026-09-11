// main.js
const { ipcRenderer } = require("electron");

let SERVER_URL = "http://localhost:3000";
let appData = {
    users: [],
    employees: [],
    inventory: [],
    requests: [],
    notifications: [], // 알림 목록 데이터
    settings: { companyName: "basic_ERP" }
};

let currentUser = null;
let selectedInventoryId = null;
let autoRefreshTimer = null; // 자동 갱신 타이머

function getTodayString() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// alert 확인 후 해당 입력 요소에 커서(포커스) 지정해주는 도우미 함수
function setFocus(elementId) {
    setTimeout(() => {
        const el = document.getElementById(elementId);
        if (el) {
            el.focus();
            if (typeof el.select === "function") el.select();
        }
    }, 100);
}

window.addEventListener("DOMContentLoaded", async () => {
    try {
        const config = await ipcRenderer.invoke("get-config");
        if (config && config.serverUrl) {
            SERVER_URL = config.serverUrl;
        }
    } catch (err) {
        console.error("[Renderer] config 수신 실패:", err);
    }

    await loadServerData();
    setupEventListeners();

    // 3초마다 서버 데이터를 자동으로 조회하여 멀티 클라이언트 실시간 동기화
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(async () => {
        if (currentUser) {
            await loadServerData();
            renderAll();
        }
    }, 3000);
});

// 서버 데이터 조회 및 7일 이상 경과한 알림 정리
async function loadServerData() {
    const data = await ipcRenderer.invoke("load-data");
    if (data) {
        appData = {
            users: data.users || [],
            employees: data.employees || [],
            inventory: data.inventory || [],
            requests: data.requests || [],
            notifications: data.notifications || [],
            settings: data.settings || { companyName: "basic_ERP" }
        };

        // 7일(일주일) 이전 알림 자동 정리/삭제
        cleanOldNotifications();

        updateSettingsUI();
    }
}

// 일주일(7일) 이상 지난 알림 제거 함수
function cleanOldNotifications() {
    if (!appData.notifications || appData.notifications.length === 0) return;

    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const originalLength = appData.notifications.length;
    appData.notifications = appData.notifications.filter(n => {
        const createdTime = new Date(n.createdAt).getTime();
        return (now - createdTime) < SEVEN_DAYS_MS;
    });

    // 지워진 알림이 있으면 데이터베이스에 자동 반영
    if (appData.notifications.length !== originalLength) {
        ipcRenderer.invoke("save-data", appData);
    }
}

// 관리자 목록 수집 및 관리자 알림 전송 공통 함수
function notifyAllAdmins(type, itemName, userName) {
    if (!appData.notifications) appData.notifications = [];

    const adminUsers = appData.users.filter(u => u.role === "admin");
    const adminUserIds = new Set(adminUsers.map(u => u.id));
    appData.employees.forEach(e => {
        if (e.role === "admin") adminUserIds.add(e.id);
    });

    const nowIso = new Date().toISOString();

    adminUserIds.forEach(adminId => {
        appData.notifications.push({
            id: Date.now() + Math.floor(Math.random() * 1000),
            userId: adminId,
            type: type,
            itemName: itemName,
            status: "신청",
            message: `${userName}님이 ${itemName} 품목에 대한 [${type}]을(를) 신청했습니다.`,
            isRead: false,
            createdAt: nowIso
        });
    });
}

// 1. 로그인
async function login() {
    const loginIdInput = document.getElementById("loginId");
    const passwordInput = document.getElementById("loginPassword");

    const username = loginIdInput ? loginIdInput.value.trim() : "";
    const password = passwordInput ? passwordInput.value.trim() : "";

    if (!username) {
        alert("아이디를 입력해 주세요.");
        setFocus("loginId");
        return;
    }

    if (!password) {
        alert("비밀번호를 입력해 주세요.");
        setFocus("loginPassword");
        return;
    }

    try {
        const result = await ipcRenderer.invoke("login", { username, password });

        if (result && result.success) {
            currentUser = result.user;
            alert(`${currentUser.name || currentUser.loginId}님, 환영합니다!`);

            document.getElementById("loginScreen").classList.add("hidden");
            document.getElementById("appScreen").classList.remove("hidden");

            document.getElementById("currentUserName").textContent = currentUser.name || currentUser.loginId;
            document.getElementById("currentUserInfo").textContent = `${currentUser.department || "부서 미정"} / ${currentUser.position || "직원"}`;

            // 권한 제어
            const empAdd = document.getElementById("employeeAddPanel");
            const invAdd = document.getElementById("inventoryAddPanel");
            const invReq = document.getElementById("inventoryRequestManagePanel");
            const empMenuItem = document.querySelector('.menu-item[data-page="employees"]');

            if (currentUser.role !== "admin") {
                if (empAdd) empAdd.classList.add("hidden");
                if (invAdd) invAdd.classList.add("hidden");
                if (invReq) invReq.classList.add("hidden");
                if (empMenuItem) empMenuItem.classList.add("hidden");
            } else {
                if (empAdd) empAdd.classList.remove("hidden");
                if (invAdd) invAdd.classList.remove("hidden");
                if (invReq) invReq.classList.remove("hidden");
                if (empMenuItem) empMenuItem.classList.remove("hidden");
            }

            await loadServerData();
            renderAll();
            showPage("dashboard");
        } else {
            alert(result.message || "로그인에 실패했습니다.");
            setFocus("loginId");
        }
    } catch (err) {
        console.error("로그인 에러:", err);
        alert("로그인 처리 중 오류가 발생했습니다.");
    }
}

// 2. 로그아웃
function logout() {
    currentUser = null;
    document.getElementById("loginId").value = "";
    document.getElementById("loginPassword").value = "";
    document.getElementById("appScreen").classList.add("hidden");
    document.getElementById("loginScreen").classList.remove("hidden");
    setFocus("loginId");
}

// 3. 페이지 전환
function showPage(pageId) {
    const pages = document.querySelectorAll(".page");
    pages.forEach(p => p.classList.remove("active"));

    const targetPage = document.getElementById(`${pageId}Page`);
    if (targetPage) targetPage.classList.add("active");

    const menuItems = document.querySelectorAll(".menu-item");
    menuItems.forEach(m => {
        if (m.getAttribute("data-page") === pageId) m.classList.add("active");
        else m.classList.remove("active");
    });

    const pageTitles = {
        dashboard: "대시보드",
        employees: "직원 관리",
        inventory: "재고 관리",
        settings: "설정"
    };
    document.getElementById("pageTitle").textContent = pageTitles[pageId] || "대시보드";

    // 설정 페이지 전환 시 회사명 수정 권한 제어
    if (pageId === "settings") {
        updateSettingsUI();
    }
}

// 4. 전체 데이터 UI 렌더링
function renderAll() {
    document.getElementById("employeeCount").textContent = appData.employees.length;
    document.getElementById("totalInventoryCount").textContent = appData.inventory.length;

    const inUseCount = appData.inventory.filter(i => i.status === "사용중" || i.status === "이용중").length;
    document.getElementById("inUseInventoryCount").textContent = inUseCount;

    const pendingRequests = appData.requests.filter(r => r.status === "대기" || r.status === "신청중");
    document.getElementById("pendingRequestCount").textContent = pendingRequests.length;

    // 대시보드 요약 테이블
    const dashTbody = document.getElementById("dashboardInventoryTable");
    if (dashTbody) {
        dashTbody.innerHTML = appData.inventory.slice(0, 5).map(item => `
            <tr>
                <td>${item.name}</td>
                <td>${item.category || "-"}</td>
                <td>${item.serialNumber || "-"}</td>
                <td><span class="status ${item.status === "사용중" ? "status-in-use" : "status-available"}">${item.status}</span></td>
                <td>${item.currentUserName || "-"}</td>
            </tr>
        `).join("");
    }

    // 직원 목록
    const empTbody = document.getElementById("employeeTableBody");
    if (empTbody) {
        empTbody.innerHTML = appData.employees.map((emp, idx) => `
            <tr>
                <td>${idx + 1}</td>
                <td>${emp.name}</td>
                <td>${emp.department || "-"}</td>
                <td>${emp.position || "-"}</td>
                <td>${emp.role || "employee"}</td>
                <td>${emp.email || "-"}</td>
                <td><button class="danger-button" onclick="deleteEmployee(${emp.id})">삭제</button></td>
            </tr>
        `).join("");
    }

    // 재고 목록 및 신청/연장/반납 버튼
    const invTbody = document.getElementById("inventoryTableBody");
    if (invTbody) {
        invTbody.innerHTML = appData.inventory.map((inv, idx) => {
            const isMyItem = inv.currentUserId === currentUser?.id;
            let actionBtn = "-";

            if (inv.status === "이용가능") {
                actionBtn = `<button class="action-button" onclick="openApplyModal(${inv.id})">신청</button>`;
            } else if (inv.status === "사용중" && isMyItem) {
                actionBtn = `
                    <button class="action-button" onclick="openExtendModal(${inv.id})">연장</button>
                    <button class="secondary-button" onclick="openReturnModal(${inv.id})" style="height:28px; width:auto; padding:2px 8px; font-size:12px;">반납</button>
                `;
            } else if (inv.status === "승인대기" || inv.status === "반납대기") {
                actionBtn = `<span style="color:#e67e22; font-size:12px; font-weight:bold;">${inv.status}중</span>`;
            }

            return `
                <tr>
                    <td>${idx + 1}</td>
                    <td>${inv.name}</td>
                    <td>${inv.category}</td>
                    <td>${inv.serialNumber}</td>
                    <td><span class="status ${inv.status === "사용중" ? "status-in-use" : "status-available"}">${inv.status}</span></td>
                    <td>${inv.currentUserName || "-"}</td>
                    <td>${inv.endDate || "-"}</td>
                    <td>${actionBtn}</td>
                </tr>
            `;
        }).join("");
    }

    // 관리자용 신청 요청 승인/거절 목록
    const reqTbody = document.getElementById("inventoryRequestTableBody");
    if (reqTbody) {
        reqTbody.innerHTML = pendingRequests.map((req) => `
            <tr>
                <td><strong>${req.type || "신청"}</strong></td>
                <td>${req.userName} (${req.department || "부서미정"})</td>
                <td>${req.itemName}</td>
                <td>${req.reason || req.notes || "-"}</td>
                <td>${req.endDate || "-"}</td>
                <td>
                    <button class="action-button" onclick="approveRequest(${req.id})">승인</button>
                    <button class="danger-button" onclick="rejectRequest(${req.id})">거절</button>
                </td>
            </tr>
        `).join("");
    }

    // 설정 탭 계정 정보
    const myAccountDiv = document.getElementById("myAccountInfo");
    if (myAccountDiv && currentUser) {
        myAccountDiv.innerHTML = `
            <p><strong>이름:</strong> ${currentUser.name || "-"}</p>
            <p><strong>아이디:</strong> ${currentUser.loginId || "-"}</p>
            <p><strong>부서/직급:</strong> ${currentUser.department || "-"} / ${currentUser.position || "-"}</p>
            <p><strong>권한:</strong> ${currentUser.role || "employee"}</p>
            <p><strong>이메일:</strong> ${currentUser.email || "-"}</p>
            <p><strong>전화번호:</strong> ${currentUser.phone || "-"}</p>
        `;
    }

    // 알림 UI 렌더링
    renderNotifications();
}

// 알림 UI 렌더링 및 배지 갱신
function renderNotifications() {
    if (!currentUser) return;

    cleanOldNotifications();
    const myNotis = (appData.notifications || []).filter(n => n.userId === currentUser.id);
    const unreadCount = myNotis.filter(n => !n.isRead).length;

    const badgeEl = document.getElementById("notificationBadge");
    if (badgeEl) {
        if (unreadCount > 0) {
            badgeEl.textContent = unreadCount;
            badgeEl.classList.remove("hidden");
        } else {
            badgeEl.classList.add("hidden");
        }
    }

    const listEl = document.getElementById("notificationList");
    if (listEl) {
        if (myNotis.length === 0) {
            listEl.innerHTML = `<li style="padding:15px; text-align:center; color:#888; font-size:13px;">알림이 없습니다. (최근 7일)</li>`;
        } else {
            listEl.innerHTML = myNotis.slice().reverse().map(n => {
                let statusColor = "#1a73e8";
                if (n.status === '승인') statusColor = '#2e7d32';
                else if (n.status === '거절') statusColor = '#d32f2f';
                else if (n.status === '신청') statusColor = '#e67e22';

                return `
                    <li style="padding:12px 15px; border-bottom:1px solid #eee; font-size:13px; background:${n.isRead ? '#fff' : '#f0f7ff'};">
                        <div style="font-weight:bold; margin-bottom:3px; color:${statusColor};">
                            [${n.type}] ${n.status}
                        </div>
                        <div>${n.message}</div>
                        <div style="font-size:11px; color:#888; margin-top:4px;">${new Date(n.createdAt).toLocaleString('ko-KR')}</div>
                    </li>
                `;
            }).join("");
        }
    }
}

// 알림 패널 토글 및 읽음 처리
async function toggleNotificationPanel() {
    const panel = document.getElementById("notificationPanel");
    if (!panel) return;

    panel.classList.toggle("hidden");

    if (!panel.classList.contains("hidden") && currentUser) {
        let hasChanges = false;
        (appData.notifications || []).forEach(n => {
            if (n.userId === currentUser.id && !n.isRead) {
                n.isRead = true;
                hasChanges = true;
            }
        });

        if (hasChanges) {
            await ipcRenderer.invoke("save-data", appData);
            renderNotifications();
        }
    }
}

// 5. 모달 열기/닫기
function closeModal(modalId) {
    document.getElementById(modalId).classList.add("hidden");
    selectedInventoryId = null;
}

function openApplyModal(id) {
    const item = appData.inventory.find(i => i.id === id);
    if (!item) return;

    const hasPending = appData.requests.some(r => r.inventoryId === id && r.status === "대기");
    if (hasPending) {
        alert("이미 해당 품목에 대해 진행 중인 신청이 있습니다.");
        return;
    }

    selectedInventoryId = id;
    document.getElementById("applyInventoryId").value = id;
    document.getElementById("applyModalTitle").textContent = `재고 사용 신청 (${item.name})`;

    const applyDateInput = document.getElementById("applyEndDate");
    if (applyDateInput) applyDateInput.min = getTodayString();

    document.getElementById("applyModal").classList.remove("hidden");
    setFocus("applyReason");
}

function closeApplyModal() { closeModal("applyModal"); }

function openExtendModal(id) {
    const item = appData.inventory.find(i => i.id === id);
    if (!item) return;

    const hasPending = appData.requests.some(r => r.inventoryId === id && r.status === "대기");
    if (hasPending) {
        alert("이미 해당 품목에 대해 승인 대기 중인 요청이 있습니다.");
        return;
    }

    selectedInventoryId = id;
    document.getElementById("extendInventoryId").value = id;

    const extendDateInput = document.getElementById("extendEndDate");
    if (extendDateInput) {
        const minDate = item.endDate || getTodayString();
        extendDateInput.min = minDate;
        extendDateInput.value = minDate;
    }

    document.getElementById("extendModal").classList.remove("hidden");
    setFocus("extendReason");
}

function closeExtendModal() { closeModal("extendModal"); }

function openReturnModal(id) {
    const item = appData.inventory.find(i => i.id === id);
    if (!item) return;

    const hasPending = appData.requests.some(r => r.inventoryId === id && r.status === "대기");
    if (hasPending) {
        alert("이미 해당 품목에 대해 승인 대기 중인 요청이 있습니다.");
        return;
    }

    selectedInventoryId = id;
    document.getElementById("returnInventoryId").value = id;
    if (currentUser) {
        document.getElementById("returnName").value = currentUser.name || "";
        document.getElementById("returnPhone").value = currentUser.phone || "";
        document.getElementById("returnEmail").value = currentUser.email || "";
    }
    document.getElementById("returnModal").classList.remove("hidden");
    setFocus("returnNotes");
}

function closeReturnModal() { closeModal("returnModal"); }

// 6. 신청/연장/반납 동작 처리
async function submitInventoryApply() {
    const id = parseInt(document.getElementById("applyInventoryId").value) || selectedInventoryId;
    const endDate = document.getElementById("applyEndDate").value;
    const reason = document.getElementById("applyReason").value.trim();

    const hasPending = appData.requests.some(r => r.inventoryId === id && r.status === "대기");
    if (hasPending) {
        alert("이미 해당 품목에 대해 진행 중인 신청이 있습니다.");
        return;
    }

    if (!endDate) {
        alert("반납 예정일을 선택해 주세요.");
        setFocus("applyEndDate");
        return;
    }

    if (endDate < getTodayString()) {
        alert("오늘 이전의 날짜는 반납 예정일로 설정할 수 없습니다.");
        setFocus("applyEndDate");
        return;
    }

    const item = appData.inventory.find(i => i.id === id);
    if (!item) return;

    item.status = "승인대기";
    appData.requests.push({
        id: Date.now(),
        inventoryId: item.id,
        itemName: item.name,
        userId: currentUser.id,
        userName: currentUser.name,
        department: currentUser.department,
        type: "신청",
        reason: reason,
        endDate: endDate,
        status: "대기",
        createdAt: new Date().toISOString()
    });

    notifyAllAdmins("사용 신청", item.name, currentUser.name);

    alert("신청 요청을 보냈습니다. 관리자 승인 후 사용 가능합니다.");
    ipcRenderer.invoke("log-activity", `[신청] ${currentUser.name}님이 '${item.name}' 사용을 신청했습니다.`); // 로그 추가
    
    await ipcRenderer.invoke("save-data", appData);
    closeApplyModal();
    renderAll();
}

async function submitExtend() {
    const id = parseInt(document.getElementById("extendInventoryId").value) || selectedInventoryId;
    const endDate = document.getElementById("extendEndDate").value;
    const reason = document.getElementById("extendReason").value.trim();

    const item = appData.inventory.find(i => i.id === id);
    if (!item) return;

    const hasPending = appData.requests.some(r => r.inventoryId === id && r.status === "대기");
    if (hasPending) {
        alert("이미 해당 품목에 대해 승인 대기 중인 요청이 있습니다.");
        return;
    }

    if (!endDate) {
        alert("새 반납 예정일을 선택해 주세요.");
        setFocus("extendEndDate");
        return;
    }

    if (item.endDate && endDate < item.endDate) {
        alert(`기존 반납 예정일(${item.endDate})보다 이전 날짜로는 연장 신청할 수 없습니다.`);
        setFocus("extendEndDate");
        return;
    }

    if (endDate < getTodayString()) {
        alert("오늘 이전의 날짜로 연장할 수 없습니다.");
        setFocus("extendEndDate");
        return;
    }

    appData.requests.push({
        id: Date.now(),
        inventoryId: item.id,
        itemName: item.name,
        userId: currentUser.id,
        userName: currentUser.name,
        department: currentUser.department,
        type: "연장",
        reason: reason,
        endDate: endDate,
        status: "대기",
        createdAt: new Date().toISOString()
    });

    notifyAllAdmins("연장 신청", item.name, currentUser.name);

    alert("연장 요청을 보냈습니다. 관리자 승인 후 반영됩니다.");
    ipcRenderer.invoke("log-activity", `[연장] ${currentUser.name}님이 '${item.name}' 반납 연장을 신청했습니다.`); // 로그 추가
    
    await ipcRenderer.invoke("save-data", appData);
    closeExtendModal();
    renderAll();
}

async function submitReturnRequest() {
    const id = parseInt(document.getElementById("returnInventoryId").value) || selectedInventoryId;
    const item = appData.inventory.find(i => i.id === id);
    if (!item) return;

    const hasPending = appData.requests.some(r => r.inventoryId === id && r.status === "대기");
    if (hasPending) {
        alert("이미 해당 품목에 대해 승인 대기 중인 요청이 있습니다.");
        return;
    }

    const notes = document.getElementById("returnNotes").value.trim();

    item.status = "반납대기";
    appData.requests.push({
        id: Date.now(),
        inventoryId: item.id,
        itemName: item.name,
        userId: currentUser.id,
        userName: currentUser.name,
        department: currentUser.department,
        type: "반납",
        notes: notes,
        status: "대기",
        createdAt: new Date().toISOString()
    });

    notifyAllAdmins("반납 신청", item.name, currentUser.name);

    alert("반납 신청이 완료되었습니다. 관리자 승인 후 반납이 처리됩니다.");
    ipcRenderer.invoke("log-activity", `[반납] ${currentUser.name}님이 '${item.name}' 반납을 신청했습니다.`); // 로그 추가
    
    await ipcRenderer.invoke("save-data", appData);
    closeReturnModal();
    renderAll();
}

// 7. 관리자 요청 승인 / 거절 처리
async function approveRequest(reqId) {
    const req = appData.requests.find(r => r.id === reqId);
    if (!req) return;

    const item = appData.inventory.find(i => i.id === req.inventoryId);
    if (item) {
        if (req.type === "반납") {
            item.status = "이용가능";
            item.currentUserId = null;
            item.currentUserName = "";
            item.endDate = "";
        } else {
            item.status = "사용중";
            item.currentUserId = req.userId;
            item.currentUserName = req.userName;
            item.endDate = req.endDate;
        }
    }

    req.status = "승인";

    if (!appData.notifications) appData.notifications = [];
    appData.notifications.push({
        id: Date.now(),
        userId: req.userId,
        type: req.type,
        itemName: req.itemName,
        status: "승인",
        message: req.type === "연장" ? `반납 예정일이 ${req.endDate}로 연장 처리되었습니다.` : `요청하신 [${req.itemName}] ${req.type}이(가) 승인되었습니다.`,
        isRead: false,
        createdAt: new Date().toISOString()
    });

    await ipcRenderer.invoke("save-data", appData);
    alert("요청이 승인되었습니다.");
    
    // [추가] 모든 승인 내역 활동 로그 기록
    ipcRenderer.invoke("log-activity", `[${req.type} 승인] 관리자가 ${req.userName}님의 '${req.itemName}' ${req.type} 요청을 승인했습니다.`);

    renderAll();
}

async function rejectRequest(reqId) {
    const req = appData.requests.find(r => r.id === reqId);
    if (!req) return;

    const item = appData.inventory.find(i => i.id === req.inventoryId);
    if (item) {
        if (req.type === "신청") {
            item.status = "이용가능";
        } else if (req.type === "반납" || req.type === "연장") {
            item.status = "사용중";
        }
    }

    req.status = "거절";

    if (!appData.notifications) appData.notifications = [];
    appData.notifications.push({
        id: Date.now(),
        userId: req.userId,
        type: req.type,
        itemName: req.itemName,
        status: "거절",
        message: `요청하신 [${req.itemName}] ${req.type}이(가) 거절되었습니다.`,
        isRead: false,
        createdAt: new Date().toISOString()
    });

    await ipcRenderer.invoke("save-data", appData);
    alert("요청이 거절되었습니다.");

    // [추가] 모든 거절 내역 활동 로그 기록
    ipcRenderer.invoke("log-activity", `[${req.type} 거절] 관리자가 ${req.userName}님의 '${req.itemName}' ${req.type} 요청을 거절했습니다.`);

    renderAll();
}

// 8. 신규 직원 등록
async function addEmployee() {
    const nameInput = document.getElementById("employeeName");
    const deptInput = document.getElementById("employeeDepartment");
    const posInput = document.getElementById("employeePosition");

    const name = nameInput ? nameInput.value.trim() : "";
    const department = deptInput ? deptInput.value.trim() : "";
    const position = posInput ? posInput.value.trim() : "";

    if (!name) {
        alert("직원 이름을 입력해 주세요.");
        setFocus("employeeName");
        return;
    }

    const newEmp = {
        id: Date.now(),
        name,
        department,
        position,
        role: "employee",
        email: "-",
        phone: "-"
    };

    appData.employees.push(newEmp);

    await ipcRenderer.invoke("save-data", appData);
    alert("신규 직원이 등록되었습니다.");

    if (nameInput) nameInput.value = "";
    if (deptInput) deptInput.value = "";
    if (posInput) posInput.value = "";

    renderAll();
}

// 9. 신규 재고 등록
async function addInventory() {
    const nameInput = document.getElementById("invName");
    const categoryInput = document.getElementById("invCategory");
    const serialInput = document.getElementById("invSerial");

    const name = nameInput ? nameInput.value.trim() : "";
    const category = categoryInput ? categoryInput.value.trim() : "";
    const serialNumber = serialInput ? serialInput.value.trim() : "";

    if (!name) {
        alert("품목명을 입력해 주세요.");
        setFocus("invName");
        return;
    }

    const newItem = {
        id: Date.now(),
        name,
        category: category || "기타",
        serialNumber: serialNumber || "-",
        status: "이용가능",
        currentUserId: null,
        currentUserName: "",
        endDate: "",
        createdAt: new Date().toISOString()
    };

    appData.inventory.push(newItem);

    const success = await ipcRenderer.invoke("save-data", appData);
    if (success !== false) {
        alert("신규 재고가 등록되었습니다.");
        if (nameInput) nameInput.value = "";
        if (categoryInput) categoryInput.value = "";
        if (serialInput) serialInput.value = "";
        renderAll();
    } else {
        alert("재고 등록 처리 중 오류가 발생했습니다.");
    }
}

// 10. 직원 삭제
async function deleteEmployee(id) {
    if (!confirm("해당 직원을 삭제하시겠습니까?")) return;
    const emp = appData.employees.find(e => e.id === id); // 삭제 전 직원 정보 찾기
    
    appData.employees = appData.employees.filter(e => e.id !== id);
    await ipcRenderer.invoke("save-data", appData);
    
    // 로그 추가
    if (emp) ipcRenderer.invoke("log-activity", `직원 삭제: ${emp.name} (${emp.department || '부서없음'})`);
    
    renderAll();
}

// 11. 설정 업데이트 및 권한 제어
function updateSettingsUI() {
    const compName = appData.settings.companyName || "basic_ERP";
    document.getElementById("topCompanyName").textContent = compName;
    document.getElementById("companyLogo").textContent = compName;
    
    const compInput = document.getElementById("companyName");
    const saveBtn = document.querySelector("#settingsPage .primary-button");

    if (compInput) {
        compInput.value = compName;
        // 관리자가 아닌 경우 입력창 비활성화
        if (currentUser && currentUser.role !== "admin") {
            compInput.disabled = true;
            compInput.title = "회사명 변경은 관리자만 가능합니다.";
        } else {
            compInput.disabled = false;
            compInput.removeAttribute("title");
        }
    }

    if (saveBtn) {
        // 관리자가 아닌 경우 설정 저장 버튼 비활성화 및 안보이게 처리
        if (currentUser && currentUser.role !== "admin") {
            saveBtn.disabled = true;
            saveBtn.style.opacity = "0.5";
            saveBtn.style.cursor = "not-allowed";
        } else {
            saveBtn.disabled = false;
            saveBtn.style.opacity = "1";
            saveBtn.style.cursor = "pointer";
        }
    }
}

async function saveSettings() {
    if (!currentUser || currentUser.role !== "admin") {
        alert("회사명 변경은 관리자 권한이 필요합니다.");
        return;
    }

    const newName = document.getElementById("companyName").value.trim();
    if (!newName) {
        alert("회사명을 입력해 주세요.");
        setFocus("companyName");
        return;
    }

    appData.settings.companyName = newName;
    await ipcRenderer.invoke("save-data", appData);
    updateSettingsUI();
    alert("설정이 저장되었습니다.");
}

// 12. 회원가입 모달
function openSignup() {
    document.getElementById("signupModal").classList.remove("hidden");
    setFocus("signupId");
}
function closeSignup() { document.getElementById("signupModal").classList.add("hidden"); }

async function signup() {
    const loginId = document.getElementById("signupId").value.trim();
    const password = document.getElementById("signupPassword").value;
    const passwordConfirm = document.getElementById("signupPasswordConfirm").value;
    const name = document.getElementById("signupName").value.trim();
    const department = document.getElementById("signupDepartment").value.trim();
    const position = document.getElementById("signupPosition").value.trim();
    const email = document.getElementById("signupEmail").value.trim();
    const phone = document.getElementById("signupPhone").value.trim();
    const role = document.getElementById("signupRole").value;

    if (!loginId) {
        alert("아이디를 입력해 주세요.");
        setFocus("signupId");
        return;
    }
    if (!password) {
        alert("비밀번호를 입력해 주세요.");
        setFocus("signupPassword");
        return;
    }
    if (!name) {
        alert("이름을 입력해 주세요.");
        setFocus("signupName");
        return;
    }

    if (password !== passwordConfirm) {
        alert("비밀번호 확인이 일치하지 않습니다.");
        setFocus("signupPasswordConfirm");
        return;
    }

    const newUser = {
        id: Date.now(),
        loginId, password, name, department, position, email, phone, role,
        createdAt: new Date().toISOString()
    };

    appData.users.push(newUser);
    appData.employees.push({
        id: newUser.id, name, department, position, role, email, phone, loginId
    });

    await ipcRenderer.invoke("save-data", appData);
    alert("회원가입이 완료되었습니다.");
    closeSignup();
}

// 13. 비밀번호 변경 처리 함수
async function changePassword() {
    if (!currentUser) {
        alert("로그인 정보가 없습니다.");
        return;
    }

    const currentPasswordInput = document.getElementById("currentPassword");
    const newPasswordInput = document.getElementById("newPassword");
    const newPasswordConfirmInput = document.getElementById("newPasswordConfirm");

    const currentPassword = currentPasswordInput ? currentPasswordInput.value.trim() : "";
    const newPassword = newPasswordInput ? newPasswordInput.value.trim() : "";
    const newPasswordConfirm = newPasswordConfirmInput ? newPasswordConfirmInput.value.trim() : "";

    if (!currentPassword) {
        alert("원래 비밀번호를 입력해 주세요.");
        setFocus("currentPassword");
        return;
    }

    if (!newPassword) {
        alert("새로운 비밀번호를 입력해 주세요.");
        setFocus("newPassword");
        return;
    }

    if (!newPasswordConfirm) {
        alert("새로운 비밀번호 확인을 입력해 주세요.");
        setFocus("newPasswordConfirm");
        return;
    }

    if (newPassword !== newPasswordConfirm) {
        alert("새로운 비밀번호와 비밀번호 확인이 일치하지 않습니다.");
        setFocus("newPasswordConfirm");
        return;
    }

    if (currentPassword === newPassword) {
        alert("기존 비밀번호와 새로운 비밀번호가 동일합니다.");
        setFocus("newPassword");
        return;
    }

    try {
        const result = await ipcRenderer.invoke("change-password", {
            userId: currentUser.id,
            currentPassword,
            newPassword
        });

        if (result && result.success) {
            alert("비밀번호가 성공적으로 변경되었습니다. 다시 로그인해 주세요.");
            
            // 입력창 초기화
            currentPasswordInput.value = "";
            newPasswordInput.value = "";
            newPasswordConfirmInput.value = "";

            // 보안을 위해 로그아웃 처리
            logout();
        } else {
            alert(result.message || "비밀번호 변경에 실패했습니다.");
            setFocus("currentPassword");
        }
    } catch (err) {
        console.error("비밀번호 변경 오류:", err);
        alert("비밀번호 변경 처리 중 오류가 발생했습니다.");
    }
}

// 14. 전체화면 토글
async function toggleFullscreen() {
    await ipcRenderer.invoke("toggle-fullscreen");
}

function setupEventListeners() {
    const passInput = document.getElementById("loginPassword");
    if (passInput) {
        passInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") login();
        });
    }
}

// 전역 바인딩
window.login = login;
window.logout = logout;
window.showPage = showPage;
window.openSignup = openSignup;
window.closeSignup = closeSignup;
window.signup = signup;
window.saveSettings = saveSettings;
window.changePassword = changePassword;
window.toggleFullscreen = toggleFullscreen;
window.addEmployee = addEmployee;
window.addInventory = addInventory;
window.deleteEmployee = deleteEmployee;
window.openApplyModal = openApplyModal;
window.closeApplyModal = closeApplyModal;
window.openExtendModal = openExtendModal;
window.closeExtendModal = closeExtendModal;
window.openReturnModal = openReturnModal;
window.closeReturnModal = closeReturnModal;
window.closeModal = closeModal;
window.submitInventoryApply = submitInventoryApply;
window.submitExtend = submitExtend;
window.submitReturnRequest = submitReturnRequest;
window.approveRequest = approveRequest;
window.rejectRequest = rejectRequest;
window.toggleNotificationPanel = toggleNotificationPanel;