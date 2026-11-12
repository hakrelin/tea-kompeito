const roles = { member: "普通成员", reader: "授权成员", admin: "管理员" };

async function post(action, body) {
  const response = await fetch("/api/" + action, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "暂时无法完成操作。");
  return data;
}

export function setupAccount(view, { account, setup }, params, onSessionChange) {
  const wantsAdmin = params.get("next") === "admin";
  const login = view.querySelector("#login");
  const submit = view.querySelector("#login-submit");
  const logout = view.querySelector("#logout");
  const status = view.querySelector("#account-status");
  const switchMode = view.querySelector("#account-switch");
  const registering = !setup && !account && params.get("mode") === "register";
  const action = setup ? "setup" : registering ? "register" : "login";
  const creating = action !== "login";
  view.querySelector("#account-title").textContent = account?.username ||
    (setup ? "创建首个管理员" : registering ? "注册账号" : "账号登录");
  view.querySelector("#confirm-field").hidden = !creating;
  const { username, password, confirm } = login.elements;
  confirm.disabled = !creating;
  confirm.required = creating;
  password.minLength = creating ? 10 : 1;
  password.autocomplete = creating ? "new-password" : "current-password";
  submit.textContent = setup ? "创建并登录" : registering ? "注册并登录" : "登录";
  login.hidden = Boolean(account);
  switchMode.hidden = Boolean(account) || setup;
  if (registering) {
    switchMode.firstElementChild.textContent = "已有账号？";
    switchMode.lastElementChild.textContent = "登录";
    switchMode.lastElementChild.href = "/account.html";
  }
  view.querySelector("#profile").hidden = !account;
  if (account) {
    view.querySelector("#profile-role").textContent = roles[account.role];
    view.querySelector("#admin-link").hidden = account.role !== "admin";
  }
  status.textContent = creating ? "账号使用 3 至 32 个字母、数字、点、下划线或连字符。密码至少 10 个字符。"
    : wantsAdmin && account ? "进入内容管理需要管理员权限。" : "";

  login.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (creating && confirm.value !== password.value) {
      status.textContent = "两次输入的密码不同。";
      confirm.focus();
      return;
    }
    submit.disabled = true;
    status.textContent = registering ? "正在注册…" : "正在登录…";
    try {
      const result = await post(action, { username: username.value, password: password.value });
      login.reset();
      onSessionChange(!wantsAdmin && result.account.role !== "admin");
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  logout.addEventListener("click", async () => {
    logout.disabled = true;
    try {
      await post("logout", {});
      onSessionChange(true);
    } catch (error) {
      status.textContent = error.message;
      logout.disabled = false;
    }
  });
}
