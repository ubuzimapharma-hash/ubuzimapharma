const $ = (selector) => document.querySelector(selector);
const cfg = window.UBUZIMA_CONFIG || {};
const configuredWhatsApp = String(cfg.whatsappNumber || "");
const whatsapp = configuredWhatsApp.includes("X") ? "" : configuredWhatsApp.replace(/\D/g, "");
const CART_STORAGE_KEY = "ubuzimaPharmaCart";
const INITIAL_PRODUCT_COUNT = 6;
const apiBaseUrl = String(cfg.apiBaseUrl || "").replace(/\/+$/, "");
let products = [];
let cart = {};
let csrfToken = "";
let currentStaff = null;
let staffNewsArticles = [];
let staffVideos = [];
let newsEditingStatus = "draft";
let newsAutosaveTimer = 0;
let savedNewsSelection = null;
let staffVideoPreviewUrl = "";

function apiUrl(path) {
  return `${apiBaseUrl}${path}`;
}

function contentSettingsKey(role = document.body.dataset.staffRole || "pharmacist") {
  return `ubuzimaContentSettings:${role}`;
}

function readContentSettings() {
  try {
    const settings = JSON.parse(localStorage.getItem(contentSettingsKey()) || "{}");
    return {
      autosave: settings.autosave !== false,
      defaultCategory: ["Ubuzima", "Ubuzima rusange", "Imiti", "Ubushakashatsi"].includes(settings.defaultCategory)
        ? settings.defaultCategory
        : "Ubuzima",
      pageWidth: ["wide", "normal", "narrow"].includes(settings.pageWidth) ? settings.pageWidth : "wide",
      pageMargins: ["compact", "normal", "spacious"].includes(settings.pageMargins) ? settings.pageMargins : "normal"
    };
  } catch (error) {
    console.error("Could not read content settings.", error);
    return { autosave: true, defaultCategory: "Ubuzima", pageWidth: "wide", pageMargins: "normal" };
  }
}

function productImageUrl(path) {
  return new URL(path, apiBaseUrl || window.location.href).href;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    credentials: "include",
    ...options
  });
  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Ntivyashobotse kurangura amakuru.");
  return result;
}

async function getCsrfToken() {
  const result = await apiRequest("/api/auth/csrf");
  csrfToken = result.csrfToken;
  return csrfToken;
}

async function adminRequest(path, options = {}) {
  if (!csrfToken) await getCsrfToken();
  const headers = new Headers(options.headers || {});
  headers.set("X-CSRF-Token", csrfToken);
  return apiRequest(path, { ...options, headers });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function setStatus(message, isError = false) {
  ["#managerStatus", "#catalogueStatus"].forEach(selector => {
    const element = $(selector);
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("status-error", isError);
    element.hidden = !message;
  });
}

async function fetchProducts(path = "/api/products") {
  const result = await apiRequest(path);
  if (!Array.isArray(result)) throw new Error("API ntiyagaruye urutonde rw'imiti rwemewe.");
  products = result.map(product => ({
    ...product,
    price: product.price_bif,
    image: product.image_url || product.image || ""
  }));
  if (path === "/api/products") {
    const availableIds = new Set(products.map(product => product.id));
    const staleCartItems = Object.keys(cart).filter(id => !availableIds.has(id));
    staleCartItems.forEach(id => delete cart[id]);
    if (staleCartItems.length) saveCart();
  }
  return products;
}

function loadCart() {
  let savedCart;
  try {
    savedCart = localStorage.getItem(CART_STORAGE_KEY);
  } catch (error) {
    console.error("Could not access the saved shopping cart.", error);
    return {};
  }
  if (!savedCart) return {};
  try {
    const parsedCart = JSON.parse(savedCart);
    if (!parsedCart || typeof parsedCart !== "object" || Array.isArray(parsedCart)) return {};
    return Object.fromEntries(Object.entries(parsedCart).filter(([id, quantity]) =>
      typeof id === "string" && Number.isInteger(quantity) && quantity > 0
    ));
  } catch (error) {
    console.error("Could not read the saved shopping cart.", error);
    return {};
  }
}

function saveCart() {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch (error) {
    console.error("Could not save the shopping cart.", error);
    setStatus("Igitebo nticashoboye kubikwa muri iyi browser.", true);
  }
}

function whatsappUrl(message) {
  if (!whatsapp || whatsapp.includes("XXXXXXXX")) return null;
  return `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`;
}

function sendWhatsApp(message) {
  const url = whatsappUrl(message);
  if (!url) {
    alert("WhatsApp ntirashirwamwo. Banza ushire inomero ya WhatsApp ya UBUZIMA PHARMA muri config.js.");
    location.href = "contact.html";
    return;
  }
  window.open(url, "_blank", "noopener");
}

function renderProducts(list) {
  const grid = $("#productGrid");
  if (!grid) return;
  if (!list.length) {
    grid.innerHTML = products.length
      ? '<div class="empty-state">Nta muti uhuye n’ivyo urondera wabonetse. Gerageza irindi zina canke irindi ciciro.</div>'
      : '<div class="empty-state">Nta muti uraboneka. Subira urabe hanyuma canke utwandikire kugira umenye ibihari.</div>';
    return;
  }
  const visibleProducts = grid.dataset.catalogueMode === "preview" ? list.slice(0, INITIAL_PRODUCT_COUNT) : list;
  grid.innerHTML = visibleProducts.map(product => `
    <article class="product-card">
      <div class="product-image-wrap">
        <img class="product-image" src="${escapeHtml(productImageUrl(product.image))}" alt="${escapeHtml(product.name)}" loading="lazy">
      </div>
      <div class="product-card-body">
        <h3>${escapeHtml(product.name)}</h3>
        <span class="product-card-category">▰ ${escapeHtml(product.category || "")}</span>
        ${product.description ? `<p class="product-card-description">${escapeHtml(product.description)}</p>` : ""}
        <div class="product-card-meta">
          ${product.price !== null && product.price !== "" ? `<b class="product-price">${Number(product.price).toLocaleString("fr-FR")} ${escapeHtml(cfg.currency || "BIF")}</b>` : ""}
          <span class="product-stock-summary ${Number(product.stock_quantity) > 0 ? "available" : "check-stock"}"><b>${Number(product.stock_quantity) > 0 ? "✓ Uri mububiko" : "Ntawuri mububiko"}</b><small>${Number(product.stock_quantity) > 0 ? "Umuti uraboneka ku bakiriya" : "Kuboneka vyemezwe na farumasi"}</small></span>
        </div>
        <button class="product-use-button" type="button" data-see-use="${escapeHtml(product.id)}"><span>▤</span> Raba uko ukoreshwa <b>›</b></button>
        <div class="product-actions">
          <button class="product-cart-button" type="button" data-add-to-cart="${escapeHtml(product.id)}"><span>🛒</span> Shira mu gitebo <b>›</b></button>
          <button class="product-whatsapp-button" type="button" data-order-product="${escapeHtml(product.id)}"><span>☏</span> Tumiza kuri WhatsApp <b>›</b></button>
        </div>
      </div>
    </article>
  `).join("");
  grid.querySelectorAll(".product-image").forEach(image => {
    image.addEventListener("error", () => image.closest(".product-image-wrap").classList.add("image-unavailable"), { once: true });
  });
  grid.querySelectorAll("[data-see-use]").forEach(button => button.addEventListener("click", () => showProductUse(button.dataset.seeUse)));
  grid.querySelectorAll("[data-add-to-cart]").forEach(button => button.addEventListener("click", () => addToCart(button.dataset.addToCart)));
  grid.querySelectorAll("[data-order-product]").forEach(button => button.addEventListener("click", () => orderProduct(button.dataset.orderProduct)));
}

function showProductUse(id) {
  const product = products.find(item => String(item.id) === String(id));
  if (!product) return;
  let dialog = document.querySelector("#productUseDialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "productUseDialog";
    dialog.className = "product-use-dialog";
    document.body.append(dialog);
    dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  }
  const info = [
    ["Insiguro", product.description],
    ["Ivyo umuti ukoreshwa", product.indications],
    ["Izina rusangi", product.generic_name],
    ["Ibiyigize umuti", product.active_ingredient],
    ["Ubukomezi / ingero", product.strength],
    ["Uko umuti uteye", product.dosage_form],
    ["Ingano y'ipaki", product.pack_size],
    ["Uwawukoze canke ikirango", product.manufacturer],
    ["Uko ukoreshwa", product.directions_for_use],
    ["Imburi", product.warnings],
    ["Uko ubikwa", product.storage_instructions]
  ].filter(([, value]) => typeof value === "string" && value.trim());
  dialog.innerHTML = `<div class="product-use-header"><div><span class="product-category">${escapeHtml(product.category || "")}</span><h2 id="productUseTitle">${escapeHtml(product.name)}</h2></div><button class="icon-button" type="button" data-close-use aria-label="Funga">×</button></div><div class="product-use-layout"><div class="product-use-image-wrap"><img class="product-use-image" src="${escapeHtml(productImageUrl(product.image))}" alt="${escapeHtml(product.name)}"></div><div class="product-use-content">${info.map(([title, value]) => `<details class="product-use-section"><summary>${escapeHtml(title)}</summary><p>${escapeHtml(value)}</p></details>`).join("")}<p class="product-detail-disclaimer">Aya makuru ntasubirira impanuro z'umuganga canke umufarumasiye. Baza umuhinga imbere yo gukoresha umuti.</p></div></div>`;
  const image = dialog.querySelector(".product-use-image");
  image.addEventListener("error", () => image.closest(".product-use-image-wrap").classList.add("image-unavailable"), { once: true });
  dialog.querySelector("[data-close-use]").addEventListener("click", () => dialog.close());
  dialog.showModal();
}

function renderFilters() {
  const filters = $("#categoryFilters");
  if (!filters) return;
  const categories = ["Vyose", ...new Set(products.map(product => product.category))];
  filters.innerHTML = categories.map((category, index) =>
    `<button class="filter-btn ${index === 0 ? "active" : ""}" type="button" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`
  ).join("");
  filters.querySelectorAll("button").forEach(button => button.addEventListener("click", () => {
    filters.querySelectorAll("button").forEach(filter => filter.classList.remove("active"));
    button.classList.add("active");
    filterProducts();
  }));
}

function getFilteredProducts() {
  const query = ($("#searchInput")?.value || "").toLocaleLowerCase();
  const category = $("#categoryFilters .active")?.dataset.category || "Vyose";
  return products.filter(product =>
    (category === "Vyose" || product.category === category) &&
    [
      product.name, product.category, product.description, product.indications, product.generic_name, product.active_ingredient,
      product.strength, product.dosage_form, product.pack_size, product.manufacturer
    ].filter(Boolean).join(" ").toLocaleLowerCase().includes(query)
  );
}

function filterProducts() {
  renderProducts(getFilteredProducts());
}

function renderCart() {
  const itemsElement = $("#cartItems");
  const items = Object.entries(cart)
    .map(([id, quantity]) => ({ product: products.find(item => item.id === id), quantity }))
    .filter(item => item.product);
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  const countElement = $("#cartCount");
  if (countElement) countElement.textContent = String(count);
  if (!itemsElement) return;
  itemsElement.innerHTML = items.length ? items.map(({ product, quantity }) => `
    <div class="cart-item">
      <img src="${escapeHtml(productImageUrl(product.image))}" alt="">
      <div class="cart-item-info"><b>${escapeHtml(product.name)}</b><small>${escapeHtml(product.category)}</small>
        <div class="cart-quantity">
          <button type="button" data-cart-change="-1" data-id="${escapeHtml(product.id)}" aria-label="Gabanya">${"−"}</button>
          <span>${quantity}</span>
          <button type="button" data-cart-change="1" data-id="${escapeHtml(product.id)}" aria-label="Ongereza">+</button>
          <button type="button" class="cart-remove" data-cart-remove="${escapeHtml(product.id)}">Kuramwo</button>
        </div>
      </div>
      ${product.price !== null && product.price !== "" ? `<b>${(Number(product.price) * quantity).toLocaleString("fr-FR")} ${escapeHtml(cfg.currency || "BIF")}</b>` : ""}
    </div>
  `).join("") : '<p class="cart-empty">Nta muti urashira mu gitebo.</p>';
  const totalElement = $("#cartTotal");
  if (totalElement) {
    const pricedItems = items.filter(item => item.product.price !== null && item.product.price !== "");
    if (pricedItems.length === items.length && items.length) {
      const total = pricedItems.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0);
      totalElement.textContent = `Igiteranyo: ${total.toLocaleString("fr-FR")} ${cfg.currency || "BIF"}`;
    } else {
      totalElement.textContent = items.length ? "Ibiciro vyemezwa na farumasi." : "";
    }
  }
  itemsElement.querySelectorAll("[data-cart-change]").forEach(button => button.addEventListener("click", () => {
    const id = button.dataset.id;
    cart[id] = (cart[id] || 0) + Number(button.dataset.cartChange);
    if (cart[id] <= 0) delete cart[id];
    saveCart();
    renderCart();
  }));
  itemsElement.querySelectorAll("[data-cart-remove]").forEach(button => button.addEventListener("click", () => {
    delete cart[button.dataset.cartRemove];
    saveCart();
    renderCart();
  }));
  const checkout = $("#cartWhatsApp");
  if (checkout) checkout.disabled = !items.length;
}

function refreshCatalogue() {
  if (!$("#productGrid")) return;
  renderFilters();
  renderProducts($("#searchInput") ? getFilteredProducts() : products);
  renderCart();
}

function addToCart(id) {
  const product = products.find(item => item.id === id);
  if (!product) return;
  cart[id] = (cart[id] || 0) + 1;
  saveCart();
  renderCart();
  setStatus(`${product.name} yashizwe mu gitebo.`);
}

function orderProduct(id) {
  const product = products.find(item => item.id === id);
  if (!product) return;
  sendWhatsApp(`Bwakeye UBUZIMA PHARMA. Ndashaka gutumiza: ${product.name} (1). Murambwire nimba ihari n'igiciro cayo. Murakoze.`);
}

function checkoutCart() {
  const order = Object.entries(cart)
    .map(([id, quantity]) => ({ product: products.find(item => item.id === id), quantity }))
    .filter(item => item.product);
  if (!order.length) return;
  const lines = order.map(({ product, quantity }) => `- ${product.name} (${quantity})`).join("\n");
  sendWhatsApp(`Bwakeye UBUZIMA PHARMA. Ndashaka kubaza no gutumiza ibi:\n${lines}\nMurambwire nimba bihari n'ibiciro vyavyo. Murakoze.`);
}

function setupCatalogue() {
  if (!$("#productGrid")) return;
  renderProducts([]);
  renderCart();
  fetchProducts().then(() => {
    renderFilters();
    renderProducts($("#searchInput") ? getFilteredProducts() : products);
    renderCart();
  }).catch(error => {
    console.error("Could not load the public product catalogue.", error);
    setStatus("Ntivyashobotse kuronka urutonde rw'imiti. Subira ugerageze canke utwandikire.", true);
  });
  const search = $("#searchInput");
  if (search) search.addEventListener("input", filterProducts);
  const cartDialog = $("#cartDialog");
  const openCart = $("#openCart");
  const closeCart = $("#closeCart");
  const checkoutButton = $("#cartWhatsApp");
  if (openCart && cartDialog) openCart.addEventListener("click", () => cartDialog.showModal());
  if (closeCart && cartDialog) closeCart.addEventListener("click", () => cartDialog.close());
  if (checkoutButton) checkoutButton.addEventListener("click", checkoutCart);
  if (cartDialog) cartDialog.addEventListener("click", event => {
    if (event.target === cartDialog) cartDialog.close();
  });
}

function setupProductDetailPage() {
  const content = $("#productDetailContent");
  if (!content) return;
  const status = $("#productDetailStatus");
  const productId = new URLSearchParams(window.location.search).get("id");
  if (!productId) {
    status.textContent = "Hitamwo umuti ushaka kuraba.";
    status.hidden = false;
    return;
  }

  fetchProducts().then(() => {
    const product = products.find(item => item.id === productId);
    if (!product) {
      status.textContent = "Uwo muti ntukiboneka kuri uru rutonde. Subira ku miti yose.";
      status.hidden = false;
      return;
    }

    document.title = `${product.name} | UBUZIMA PHARMA`;
    const facts = [
      ["Izina rusangi", product.generic_name],
      ["Ibigize umuti", product.active_ingredient],
      ["Ubukomezi / ingero", product.strength],
      ["Uko umuti uteye", product.dosage_form],
      ["Ingano y'ipaki", product.pack_size],
      ["Uwawukoze", product.manufacturer]
    ].filter(([, value]) => typeof value === "string" && value.trim());
    const detailSections = [
      ["Ivyo umuti ukoreshwa", product.indications],
      ["Uko ukoreshwa", product.directions_for_use],
      ["Imburi", product.warnings],
      ["Uko ubikwa", product.storage_instructions]
    ].filter(([, value]) => typeof value === "string" && value.trim());
    const stock = Number(product.stock_quantity);
    content.innerHTML = `
      <section class="product-detail-hero">
        <div class="product-detail-image-wrap">
          <img class="product-detail-image" src="${escapeHtml(productImageUrl(product.image))}" alt="${escapeHtml(product.name)}">
        </div>
        <div class="product-detail-summary">
          <span class="product-category">${escapeHtml(product.category)}</span>
          <h1>${escapeHtml(product.name)}</h1>
          ${product.price !== null && product.price !== "" ? `<p class="product-detail-price">${Number(product.price).toLocaleString("fr-FR")} ${escapeHtml(cfg.currency || "BIF")}</p>` : ""}
          <p class="product-detail-description">${escapeHtml(product.description)}</p>
          <div class="product-detail-badges">
            <span class="product-detail-badge">${escapeHtml(product.category)}</span>
            <span class="product-detail-badge ${stock > 0 ? "in-stock" : "stock-check"}">${stock > 0 ? `Mu bubiko: ${stock}` : "Baza farumasi ku bubiko"}</span>
          </div>
          <a class="product-detail-enquiry" href="#" id="productDetailEnquiry">Baza ibijanye n'uyu muti kuri WhatsApp</a>
        </div>
      </section>
      <section class="product-detail-information">
        <h2>Amakuru arambuye</h2>
        <h3>Insiguro</h3>
        <p>${escapeHtml(product.description)}</p>
        ${facts.length ? `<h3>Ibiyigize n'ibiranga</h3><dl class="product-detail-facts">${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>` : ""}
        ${detailSections.map(([label, value]) => `<section class="product-detail-note"><h3>${escapeHtml(label)}</h3><p>${escapeHtml(value)}</p></section>`).join("")}
        <p class="product-detail-disclaimer">Aya makuru yinjizwa na farumasi. Baza umukozi abifitiye ububasha imbere yo gukoresha umuti; ntukoreshe aya makuru nk'impanuro yo kwivuza.</p>
      </section>
    `;
    const image = content.querySelector(".product-detail-image");
    image.addEventListener("error", () => image.closest(".product-detail-image-wrap").classList.add("image-unavailable"), { once: true });
    content.querySelector("#productDetailEnquiry").addEventListener("click", event => {
      event.preventDefault();
      sendWhatsApp(`Bwakeye UBUZIMA PHARMA. Ndashaka amakuru arambuye ku muti: ${product.name}. Murambwire nimba uhari n'igiciro cawo. Murakoze.`);
    });
  }).catch(error => {
    console.error("Could not load product details.", error);
    status.textContent = "Ntivyashobotse kuronka amakuru y'umuti. Subira ugerageze canke utwandikire.";
    status.hidden = false;
  });
}

function renderManagedProducts() {
  const list = $("#managedProducts");
  if (!list) return;
  list.innerHTML = products.length ? products.map(product => `
    <article class="managed-product">
      <img src="${escapeHtml(productImageUrl(product.image))}" alt="">
      <div><b>${escapeHtml(product.name)}</b><small>${escapeHtml(product.category)} · Ububiko: ${product.stock_quantity} · ${product.is_available ? "Biraboneka" : "Birahishijwe"}</small></div>
      <button type="button" data-edit-product="${escapeHtml(product.id)}">Hindura</button>
      <button type="button" data-toggle-availability="${escapeHtml(product.id)}">${product.is_available ? "Hisha" : "Erekana"}</button>
      <button type="button" class="danger-button" data-delete-product="${escapeHtml(product.id)}">Siba</button>
    </article>
  `).join("") : '<p class="empty-state">Nta muti urashirwamwo.</p>';
  list.querySelectorAll("[data-edit-product]").forEach(button => button.addEventListener("click", () => editProduct(button.dataset.editProduct)));
  list.querySelectorAll("[data-toggle-availability]").forEach(button => button.addEventListener("click", () => toggleProductAvailability(button.dataset.toggleAvailability)));
  list.querySelectorAll("[data-delete-product]").forEach(button => button.addEventListener("click", () => deleteProduct(button.dataset.deleteProduct)));
}

function editProduct(id) {
  const product = products.find(item => item.id === id);
  if (!product) return;
  $("#productId").value = product.id;
  $("#productName").value = product.name;
  $("#productCategory").value = product.category;
  $("#productDescription").value = product.description;
  $("#productGenericName").value = product.generic_name || "";
  $("#productActiveIngredient").value = product.active_ingredient || "";
  $("#productStrength").value = product.strength || "";
  $("#productDosageForm").value = product.dosage_form || "";
  $("#productPackSize").value = product.pack_size || "";
  $("#productManufacturer").value = product.manufacturer || "";
  $("#productIndications").value = product.indications || "";
  $("#productDirections").value = product.directions_for_use || "";
  $("#productWarnings").value = product.warnings || "";
  $("#productStorage").value = product.storage_instructions || "";
  $("#productExtraFields").open = [
    product.generic_name, product.active_ingredient, product.strength, product.dosage_form,
    product.pack_size, product.manufacturer, product.indications, product.directions_for_use, product.warnings,
    product.storage_instructions
  ].some(Boolean);
  $("#productPrice").value = product.price ?? "";
  $("#productStock").value = product.stock_quantity ?? 0;
  $("#productAvailability").checked = product.is_available;
  $("#imagePreview").src = productImageUrl(product.image);
  $("#imagePreview").hidden = false;
  $("#productImageUrl").value = product.image_url || "";
  $("#imageHelp").textContent = "Ifoto iriho iragumaho iyo udahisemwo iyindi. JPEG, PNG canke WebP; ntirenge 5 MB.";
  $("#saveProduct").textContent = "Bika ivyo wahinduye";
  $("#productName").focus();
}

async function reloadStaffData() {
  if (document.body.dataset.staffRole === "doctor") {
    await loadDoctorConsultations();
    return;
  }
  await fetchProducts("/api/admin/products");
  renderManagedProducts();
  refreshCatalogue();
  updatePharmacistSummary();
  const productCount = $("#adminProductCount");
  if (productCount) productCount.textContent = String(products.length);
  await loadAuditLogs();
  await loadStaffNews();
  await loadStaffVideos();
  await loadStaffCareRequests();
  if (document.body.dataset.staffRole === "admin") await loadAdminData();
}

function updatePharmacistSummary() {
  const total = products.length;
  const available = products.filter(product => product.is_available).length;
  const lowStock = products.filter(product => Number(product.stock_quantity) <= 5).length;
  const counts = {
    "#pharmacistProductCount": total,
    "#pharmacistAvailableCount": available,
    "#pharmacistLowStockCount": lowStock,
    "#pharmacistSideProductCount": total
  };
  Object.entries(counts).forEach(([selector, count]) => {
    const element = $(selector);
    if (element) element.textContent = String(count);
  });
}

async function toggleProductAvailability(id) {
  const product = products.find(item => item.id === id);
  if (!product) return;
  try {
    await adminRequest(`/api/admin/products/${encodeURIComponent(id)}/availability`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_available: !product.is_available })
    });
    await reloadStaffData();
    setStatus(product.is_available ? "Umuti wahishijwe ku rutonde rw'abakiriya." : "Umuti urasubiye kugaragara ku rutonde.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function deleteProduct(id) {
  const product = products.find(item => item.id === id);
  if (!product || !confirm(`Urashaka gusiba ${product.name}?`)) return;
  try {
    await adminRequest(`/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE" });
    delete cart[id];
    saveCart();
    await reloadStaffData();
    setStatus("Umuti wasibwe.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function loadAuditLogs() {
  const list = $("#auditLogList");
  if (!list) return;
  const entries = await adminRequest("/api/admin/audit-logs");
  list.innerHTML = entries.length ? entries.map(entry => `
    <article class="audit-log-entry">
      <b>${escapeHtml(entry.action)}</b>
      <span>${escapeHtml(entry.details?.name || "")}</span>
      <small>${escapeHtml(entry.username || "Umukozi") } · ${escapeHtml(new Date(entry.created_at).toLocaleString())}</small>
    </article>
  `).join("") : '<p class="empty-state">Nta mateka ahari.</p>';
}

function showStaffDashboard(staff) {
  currentStaff = staff;
  try {
    sessionStorage.setItem("ubuzimaStaffSession", JSON.stringify({ username: staff.username, role: staff.role }));
  } catch (error) {
    console.warn("Could not cache the staff display state for page navigation.", error);
  }
  document.body.classList.remove("staff-login-page");
  $("#staffLoginPanel").hidden = true;
  $("#staffDashboard").hidden = false;
  const displayName = staff.full_name || staff.username;
  const roleName = ({ admin: "Umuyobozi", pharmacist: "Umufarumasiye", doctor: "Umuganga" })[staff.role] || staff.role;
  $("#staffIdentity").textContent = `${displayName} (${roleName})`;
  const topbarIdentity = $("#pharmacistTopbarIdentity");
  if (topbarIdentity) topbarIdentity.textContent = `${displayName} (${roleName})`;
  const avatar = $("#staffProfileAvatar");
  if (avatar) updateProfileAvatar(avatar, staff.profile_image_url, displayName);
  document.querySelectorAll(".admin-topbar-profile > span").forEach(profileAvatar => updateProfileAvatar(profileAvatar, staff.profile_image_url, displayName));
  document.dispatchEvent(new CustomEvent("staff-session-ready", { detail: staff }));
}

function updateProfileAvatar(element, imageUrl, name) {
  if (!element) return;
  element.replaceChildren();
  if (imageUrl) {
    const image = document.createElement("img");
    image.src = productImageUrl(imageUrl);
    image.alt = `Ifoto ya ${name || "konti"}`;
    element.append(image);
  } else {
    element.textContent = name?.trim().charAt(0).toLocaleUpperCase() || "♙";
  }
}

function setupStaffProfile() {
  if (!document.body.dataset.staffRole) return;
  document.body.insertAdjacentHTML("beforeend", `<dialog class="profile-dialog" id="staffProfileDialog" aria-labelledby="staffProfileTitle"><form class="profile-edit-form" id="staffProfileForm"><header class="profile-dialog-heading"><div><span class="section-kicker">KONTI Y'UMUKOZI</span><h2 id="staffProfileTitle">Amakuru yanje</h2></div><button type="button" class="profile-dialog-close" data-close-staff-profile aria-label="Funga">×</button></header><div class="profile-account-avatar" id="staffProfileAvatar">♙</div><label for="staffProfileName">Amazina yuzuye</label><input id="staffProfileName" name="full_name" type="text" maxlength="120" autocomplete="name" required><label for="staffProfilePhone">Inomero ya telefone</label><input id="staffProfilePhone" name="phone" type="tel" maxlength="30" autocomplete="tel"><label for="staffProfileImage">Ifoto ya konti</label><input id="staffProfileImage" name="image" type="file" accept="image/jpeg,image/png,image/webp"><label class="profile-remove-photo"><input id="staffRemoveProfileImage" name="remove_profile_image" type="checkbox" value="true"><span>Kuraho ifoto iri kuri konti</span></label><p class="profile-photo-note">Hitamwo ifoto ya JPEG, PNG canke WebP.</p><div class="profile-dialog-actions"><button class="btn btn-outline" type="button" data-close-staff-profile>Funga</button><button class="btn btn-primary" type="submit">Bika amahinduka</button></div><p class="profile-form-status" id="staffProfileStatus" role="status" aria-live="polite"></p></form></dialog>`);
  const dialog = $("#staffProfileDialog");
  document.querySelectorAll(".admin-topbar-profile").forEach(control => {
    control.setAttribute("role", "button");
    control.setAttribute("tabindex", "0");
    control.setAttribute("aria-label", "Hindura amakuru ya konti");
    control.addEventListener("click", event => {
      event.preventDefault();
      if (!currentStaff) return setStatus("Banza winjire kugira uhindure amakuru yawe.", true);
      $("#staffProfileName").value = currentStaff.full_name || "";
      $("#staffProfilePhone").value = currentStaff.phone || "";
      $("#staffProfileImage").value = "";
      $("#staffRemoveProfileImage").checked = false;
      $("#staffProfileStatus").textContent = "";
      dialog.showModal();
    });
    control.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); control.click(); }
    });
  });
  dialog.querySelectorAll("[data-close-staff-profile]").forEach(button => button.addEventListener("click", () => dialog.close()));
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  const imageInput = $("#staffProfileImage");
  const removeImage = $("#staffRemoveProfileImage");
  imageInput.addEventListener("change", () => { if (imageInput.files.length) removeImage.checked = false; });
  removeImage.addEventListener("change", () => { if (removeImage.checked) imageInput.value = ""; });
  $("#staffProfileForm").addEventListener("submit", async event => {
    event.preventDefault();
    const status = $("#staffProfileStatus");
    const data = new FormData(event.currentTarget);
    data.set("remove_profile_image", String(removeImage.checked));
    try {
      const result = await adminRequest("/api/staff/profile", { method: "PATCH", body: data });
      showStaffDashboard(result.staff);
      status.textContent = "Amakuru ya konti yabitswe neza.";
    } catch (error) { status.textContent = error.message; status.classList.add("is-error"); }
  });
}

function showStaffLogin() {
  currentStaff = null;
  try {
    sessionStorage.removeItem("ubuzimaStaffSession");
  } catch (error) {
    console.warn("Could not clear the cached staff display state.", error);
  }
  document.body.classList.add("staff-login-page");
  $("#staffDashboard").hidden = true;
  $("#staffLoginPanel").hidden = false;
}

async function loadStaffSession() {
  let staff;
  try {
    const cachedStaff = JSON.parse(sessionStorage.getItem("ubuzimaStaffSession") || "null");
    if (cachedStaff?.username && cachedStaff.role === document.body.dataset.staffRole) {
      showStaffDashboard(cachedStaff);
    }
  } catch (error) {
    console.warn("Could not restore the staff display state.", error);
  }
  try {
    await getCsrfToken();
    const result = await apiRequest("/api/staff/session");
    if (result.staff.role !== document.body.dataset.staffRole) {
      showStaffLogin();
      setStatus("Iyi konti ikoresha urubuga rutandukanye. Injira mu rubuga ruhuye n'uburenganzira bwawe.", true);
      return;
    }
    staff = result.staff;
  } catch (error) {
    if (error.message === "Staff sign-in required.") {
      if (currentStaff?.role === document.body.dataset.staffRole) {
        setStatus("Ntivyashobotse kwemeza isesheni ubu. Urupapuro rugumye rufunguye; subira ugerageze.", true);
      } else {
        const role = ({ admin: "umuyobozi", pharmacist: "umufarumasiye", doctor: "umuganga" })[document.body.dataset.staffRole] || "umukozi";
        setStatus(`Injira ukoresheje email n'ijambobanga vya ${role} kugira ubone iki gice.`);
        showStaffLogin();
      }
    } else {
      console.error("Could not load the staff session.", error);
      setStatus(error.message, true);
      if (!currentStaff) showStaffLogin();
    }
    return;
  }
  showStaffDashboard(staff);
  try {
    await reloadStaffData();
    focusRequestedContentForm();
  } catch (error) {
    console.error("Could not load staff dashboard data.", error);
    setStatus(error.message, true);
  }
}

function focusRequestedContentForm() {
  if (new URLSearchParams(window.location.search).get("compose") !== "1") return;
  const titleField = $("#newsTitle") || $("#staffVideoTitle");
  if (titleField && !titleField.disabled) titleField.focus();
}

function setupProductManager() {
  const form = $("#productForm");
  if (!form) return;
  $("#productImage").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setStatus("Hitamwo ifoto ya JPEG, PNG canke WebP itarenza 5 MB.", true);
      event.target.value = "";
      return;
    }
    $("#imagePreview").src = URL.createObjectURL(file);
    $("#imagePreview").hidden = false;
  });
  $("#resetProductForm").addEventListener("click", resetProductForm);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const id = $("#productId").value;
    const file = $("#productImage").files[0];
    const imageUrl = $("#productImageUrl").value.trim();
    if (imageUrl && !/^https:\/\//i.test(imageUrl)) {
      setStatus("URL y'ifoto itegerezwa gutangura na https://.", true);
      return;
    }
    const formData = new FormData();
    formData.set("name", $("#productName").value.trim());
    formData.set("category", $("#productCategory").value.trim());
    formData.set("description", $("#productDescription").value.trim());
    formData.set("generic_name", $("#productGenericName").value.trim());
    formData.set("active_ingredient", $("#productActiveIngredient").value.trim());
    formData.set("strength", $("#productStrength").value.trim());
    formData.set("dosage_form", $("#productDosageForm").value.trim());
    formData.set("pack_size", $("#productPackSize").value.trim());
    formData.set("manufacturer", $("#productManufacturer").value.trim());
    formData.set("indications", $("#productIndications").value.trim());
    formData.set("directions_for_use", $("#productDirections").value.trim());
    formData.set("warnings", $("#productWarnings").value.trim());
    formData.set("storage_instructions", $("#productStorage").value.trim());
    formData.set("price_bif", $("#productPrice").value);
    formData.set("stock_quantity", $("#productStock").value);
    formData.set("is_available", String($("#productAvailability").checked));
    if (file) formData.set("image", file);
    if (imageUrl) formData.set("image_url", imageUrl);
    try {
      await adminRequest(id ? `/api/admin/products/${encodeURIComponent(id)}` : "/api/admin/products", {
        method: id ? "PUT" : "POST",
        body: formData
      });
      resetProductForm();
      await reloadStaffData();
      setStatus(id ? "Umuti wahinduwe." : "Umuti mushasha wabitswe.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });
}

function renderDoctorConsultations(consultations, container) {
  if (!container) return;
  const localDateTimeValue = date => {
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return localDate.toISOString().slice(0, 16);
  };
  const minimumAppointmentTime = localDateTimeValue(new Date());
  container.innerHTML = consultations.length ? consultations.map(consultation => {
    const completed = consultation.status === "completed";
    const scheduled = consultation.status === "scheduled" && consultation.doctor_scheduled_at;
    const currentTime = scheduled ? localDateTimeValue(new Date(consultation.doctor_scheduled_at)) : "";
    return `<article class="doctor-consultation-card" data-doctor-consultation="${escapeHtml(consultation.id)}">
      <header><div><b>${escapeHtml(consultation.patient_name)}</b><small>${escapeHtml(consultation.treatment_location)} · Yakirijwe ${escapeHtml(new Date(`${consultation.treated_on}T00:00:00`).toLocaleDateString())}</small></div><span class="care-status-pill ${completed ? "care-status-closed" : scheduled ? "care-status-in_progress" : "care-status-open"}">${escapeHtml(doctorRequestStatusLabel(consultation.status))}</span></header>
      ${scheduled ? `<div class="doctor-appointment-summary"><div><small>IGIHE CYO KUBONANA</small><b>${escapeHtml(new Date(consultation.doctor_scheduled_at).toLocaleString())}</b><span>Iminota ${Number(consultation.doctor_duration_minutes) || 30}</span></div><a href="${escapeHtml(consultation.doctor_meeting_url)}" target="_blank" rel="noopener noreferrer">Injira mu kiganiro ca videwo ↗</a></div>` : ""}
      <div class="care-request-actions">${consultation.has_prescription ? `<button type="button" class="btn btn-outline" data-doctor-prescription="${escapeHtml(consultation.id)}">Raba urupapuro rw'umuti</button>` : `<small>Nta rupapuro rw'umuti rwashizweko.</small>`}</div>
      ${completed ? `<p class="doctor-completed-note">Gukurikirana uyu murwayi vyarangiye.</p>` : `<form class="doctor-appointment-form" data-doctor-schedule="${escapeHtml(consultation.id)}"><b>${scheduled ? "Hindura igihe co kubonana" : "Tegura igihe co kubonana"}</b><label>Itariki n'isaha<input name="scheduled_at" type="datetime-local" min="${minimumAppointmentTime}" value="${currentTime}" required></label><label>Igihe c'inama<select name="duration_minutes" required>${[15, 30, 45, 60, 90, 120].map(minutes => `<option value="${minutes}" ${(Number(consultation.doctor_duration_minutes) || 30) === minutes ? "selected" : ""}>Iminota ${minutes}</option>`).join("")}</select></label><p class="doctor-meeting-generated">Link ya videwo irakorwa n'urubuga igihe ubitse gahunda.</p><button class="btn btn-primary" type="submit">${scheduled ? "Bika amahinduka" : "Rungika igihe n'umuhuza"}</button>${scheduled ? `<button class="btn btn-outline" type="button" data-doctor-complete="${escapeHtml(consultation.id)}">Menyekanisha ko inama yarangiye</button>` : ""}</form>`}
      <a class="doctor-open-messages" data-doctor-open-messages="${escapeHtml(consultation.id)}" href="messages.html?consultation_id=${encodeURIComponent(consultation.id)}">Ubutumwa bw'ibanga n'umurwayi <span aria-hidden="true">→</span></a>
    </article>`;
  }).join("") : '<p class="empty-state">Nta murwayi aragenywa kuri wewe. Subira urabe hanyuma.</p>';
}

async function loadDoctorConsultations() {
  const container = $("#doctorConsultations");
  if (!container) return;
  container.innerHTML = '<p class="empty-state">Turiko turarondera abarwayi...</p>';
  try { renderDoctorConsultations(await apiRequest("/api/doctor/consultations"), container); }
  catch (error) { container.innerHTML = `<p class="status-error">${escapeHtml(error.message)}</p>`; }
}

async function loadDoctorMessages(consultationId, container) {
  container.innerHTML = '<p class="care-message-empty">Turiko turarondera ubutumwa...</p>';
  try { renderCareMessages(container, await apiRequest(`/api/doctor/consultations/${encodeURIComponent(consultationId)}/messages`), "doctor"); }
  catch (error) { container.innerHTML = `<p class="status-error">${escapeHtml(error.message)}</p>`; }
}

function setupDoctorDashboard() {
  const list = $("#doctorConsultations");
  if (!list) return;
  const menuToggle = $("#doctorMenuToggle");
  menuToggle?.addEventListener("click", () => {
    const open = document.body.classList.toggle("admin-menu-open");
    menuToggle.setAttribute("aria-expanded", String(open));
  });
  $("#refreshDoctorConsultations").addEventListener("click", loadDoctorConsultations);
  list.addEventListener("click", async event => {
    const messageLink = event.target.closest("[data-doctor-open-messages]");
    if (messageLink) {
      try { sessionStorage.setItem("ubuzimaDoctorMessageConsultation", messageLink.dataset.doctorOpenMessages); } catch {}
    }
    const summary = event.target.closest("[data-doctor-messages]");
    const prescription = event.target.closest("[data-doctor-prescription]");
    const complete = event.target.closest("[data-doctor-complete]");
    if (summary && !summary.parentElement.open) {
      const thread = list.querySelector(`[data-doctor-thread="${CSS.escape(summary.dataset.doctorMessages)}"]`);
      if (thread) await loadDoctorMessages(summary.dataset.doctorMessages, thread);
    }
    if (prescription) {
      try { await openPrivateCarePreview(`/api/doctor/consultations/${encodeURIComponent(prescription.dataset.doctorPrescription)}/prescription`); }
      catch (error) { setStatus(error.message, true); }
    }
    if (complete && confirm("Wemeza ko inama n'uyu murwayi yarangiye?")) {
      try {
        await adminRequest(`/api/doctor/consultations/${encodeURIComponent(complete.dataset.doctorComplete)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "completed" }) });
        await loadDoctorConsultations();
        setStatus("Inama yashizweko ko yarangiye.");
      } catch (error) { setStatus(error.message, true); }
    }
  });
  list.addEventListener("submit", async event => {
    const scheduleForm = event.target.closest("[data-doctor-schedule]");
    if (scheduleForm) {
      event.preventDefault();
      const data = new FormData(scheduleForm);
      try {
        await adminRequest(`/api/doctor/consultations/${encodeURIComponent(scheduleForm.dataset.doctorSchedule)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scheduled_at: new Date(data.get("scheduled_at")).toISOString(), duration_minutes: Number(data.get("duration_minutes")) }) });
        await loadDoctorConsultations();
        setStatus("Igihe co kubonana n'umuhuzu w'ikiganiro vyarungitswe ku murwayi.");
      } catch (error) { setStatus(error.message, true); }
      return;
    }
    const replyForm = event.target.closest("[data-doctor-reply]");
    if (!replyForm) return;
    event.preventDefault();
    const consultationId = replyForm.dataset.doctorReply;
    const thread = list.querySelector(`[data-doctor-thread="${CSS.escape(consultationId)}"]`);
    try {
      await adminRequest(`/api/doctor/consultations/${encodeURIComponent(consultationId)}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: new FormData(replyForm).get("message") }) });
      replyForm.reset();
      if (thread) await loadDoctorMessages(consultationId, thread);
      setStatus("Ubutumwa burungitswe ku murwayi.");
    } catch (error) { setStatus(error.message, true); }
  });
}

function setupDoctorMessagesPage() {
  const thread = $("#doctorMessageThread");
  const form = $("#doctorMessageReply");
  if (!thread || !form) return;
  const params = new URLSearchParams(window.location.search);
  let consultationId = params.get("consultation_id") || params.get("request_id") || params.get("id") || "";
  if (!consultationId) {
    try { consultationId = sessionStorage.getItem("ubuzimaDoctorMessageConsultation") || ""; } catch {}
  }
  try { sessionStorage.removeItem("ubuzimaDoctorMessageConsultation"); } catch {}
  const heading = $("#doctorMessagePatient");
  const chooseButton = $("#doctorMessageChoose");
  const showConsultationChoices = consultations => {
    heading.textContent = "Hitamwo umurwayi kugira utangure ikiganiro.";
    form.hidden = true;
    if (chooseButton) chooseButton.hidden = true;
    thread.innerHTML = consultations.length ? consultations.map(consultation => `<button type="button" class="doctor-message-choice" data-select-consultation="${escapeHtml(consultation.id)}"><span><b>${escapeHtml(consultation.patient_name)}</b><small>${escapeHtml(consultation.treatment_location)} · ${escapeHtml(doctorRequestStatusLabel(consultation.status))}</small></span><strong>Fungura ubutumwa →</strong></button>`).join("") : '<p class="empty-state">Nta murwayi yagenywe kuri wewe.</p>';
  };
  const loadConversation = async () => {
    thread.innerHTML = '<p class="care-message-empty">Turiko turarondera ubutumwa...</p>';
    try {
      const consultations = await apiRequest("/api/doctor/consultations");
      if (!consultationId) {
        showConsultationChoices(consultations);
        return;
      }
      const consultation = consultations.find(item => String(item.id) === consultationId);
      if (!consultation) {
        consultationId = "";
        showConsultationChoices(consultations);
        setStatus("Iki kiganiro ntikiri mu biganiro vyagenywe kuri wewe. Hitamwo umurwayi akiri mu rutonde.", true);
        return;
      }
      heading.textContent = `${consultation.patient_name} · ${consultation.treatment_location}`;
      if (chooseButton) chooseButton.hidden = false;
      const messages = await apiRequest(`/api/doctor/consultations/${encodeURIComponent(consultationId)}/messages`);
      renderCareMessages(thread, messages, "doctor");
      thread.scrollTop = thread.scrollHeight;
      form.hidden = consultation.status === "completed";
      if (consultation.status === "completed") $("#doctorMessageClosedNote").hidden = false;
    } catch (error) {
      thread.innerHTML = `<p class="status-error">${escapeHtml(error.message)}</p>`;
      form.hidden = true;
    }
  };
  thread.addEventListener("click", event => {
    const choice = event.target.closest("[data-select-consultation]");
    if (!choice) return;
    consultationId = choice.dataset.selectConsultation;
    loadConversation();
  });
  chooseButton?.addEventListener("click", () => {
    consultationId = "";
    $("#doctorMessageClosedNote").hidden = true;
    loadConversation();
  });
  document.addEventListener("staff-session-ready", event => {
    if (event.detail?.role === "doctor") loadConversation();
  });
  $("#refreshDoctorMessages")?.addEventListener("click", loadConversation);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!consultationId) return;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await adminRequest(`/api/doctor/consultations/${encodeURIComponent(consultationId)}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: new FormData(form).get("message") }) });
      form.reset();
      await loadConversation();
      setStatus("Ubutumwa burungitswe ku murwayi.");
    } catch (error) { setStatus(error.message, true); }
    finally { button.disabled = false; }
  });
}

function setupPatientMessagesPage() {
  const page = $("#patientMessagePage");
  const loginPanel = $("#patientMessageLoginPanel");
  const loginForm = $("#patientMessageLoginForm");
  const dashboard = $("#patientMessageDashboard");
  const thread = $("#patientMessageThread");
  const replyForm = $("#patientMessageReply");
  if (!page || !loginPanel || !loginForm || !dashboard || !thread || !replyForm) return;

  const params = new URLSearchParams(window.location.search);
  let requestId = params.get("care_request_id") || params.get("request_id") || "";
  let conversation = params.get("conversation") || "";
  let activeRequest = null;
  const heading = $("#patientMessageHeading");
  const status = $("#patientMessageStatus");
  const chooseButton = $("#patientMessageChoose");
  const reportStatus = (message, isError = false) => {
    status.textContent = message;
    status.classList.toggle("status-error", isError);
  };
  const showConversationChoices = requests => {
    heading.textContent = "Hitamwo igisabwa kugira urabe ubutumwa.";
    replyForm.hidden = true;
    if (chooseButton) chooseButton.hidden = true;
    thread.innerHTML = requests.length ? requests.map(request => `<article class="patient-message-request-choice"><div><b>${escapeHtml(request.treatment_location)}</b><small>${escapeHtml(new Date(`${request.treated_on}T00:00:00`).toLocaleDateString())} · ${escapeHtml(careRequestStatusLabel(request.status))}</small></div><div class="patient-message-choice-actions"><button type="button" data-select-patient-thread="${escapeHtml(request.id)}" data-conversation="staff">Ubutumwa n'abakozi →</button>${request.doctor_name ? `<button type="button" data-select-patient-thread="${escapeHtml(request.id)}" data-conversation="doctor">Ubutumwa na ${escapeHtml(request.doctor_name)} →</button>` : ""}</div></article>`).join("") : '<p class="empty-state">Nta busabe bwo gufashwa buraboneka muri konti yawe.</p>';
  };
  const loadConversation = async () => {
    thread.innerHTML = '<p class="care-message-empty">Turiko turarondera ubutumwa...</p>';
    try {
      const requests = await apiRequest("/api/patient/care-requests");
      if (!requestId || !["staff", "doctor"].includes(conversation)) {
        showConversationChoices(requests);
        return;
      }
      activeRequest = requests.find(request => String(request.id) === requestId);
      if (!activeRequest || (conversation === "doctor" && !activeRequest.doctor_name)) {
        requestId = "";
        conversation = "";
        reportStatus("Ico kiganiro ntikibonetse muri konti yawe. Hitamwo igisabwa kiri mu rutonde.", true);
        showConversationChoices(requests);
        return;
      }
      const isDoctor = conversation === "doctor";
      heading.textContent = isDoctor ? `${activeRequest.doctor_name} · ${activeRequest.treatment_location}` : `Abafarumasiye n'abandi bakozi · ${activeRequest.treatment_location}`;
      if (chooseButton) chooseButton.hidden = false;
      const basePath = `/api/patient/care-requests/${encodeURIComponent(requestId)}`;
      const messages = await apiRequest(`${basePath}/${isDoctor ? "doctor-messages" : "messages"}`);
      renderCareMessages(thread, messages, "patient");
      thread.scrollTop = thread.scrollHeight;
      const closed = isDoctor ? activeRequest.doctor_consultation_status === "completed" : activeRequest.status === "closed";
      replyForm.hidden = closed;
      $("#patientMessageClosedNote").hidden = !closed;
    } catch (error) {
      thread.innerHTML = `<p class="status-error">${escapeHtml(error.message)}</p>`;
      replyForm.hidden = true;
    }
  };
  const showPatientPortal = patient => {
    loginPanel.hidden = true;
    dashboard.hidden = false;
    page.classList.remove("patient-message-login-page");
    $("#patientMessageIdentity").textContent = patient.full_name || patient.email || "Umurwayi";
    loadConversation();
  };

  thread.addEventListener("click", event => {
    const choice = event.target.closest("[data-select-patient-thread]");
    if (!choice) return;
    requestId = choice.dataset.selectPatientThread;
    conversation = choice.dataset.conversation;
    reportStatus("");
    $("#patientMessageClosedNote").hidden = true;
    loadConversation();
  });
  chooseButton?.addEventListener("click", () => {
    requestId = "";
    conversation = "";
    $("#patientMessageClosedNote").hidden = true;
    loadConversation();
  });
  $("#refreshPatientMessages")?.addEventListener("click", loadConversation);
  replyForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!requestId || !activeRequest) return;
    const button = replyForm.querySelector("button[type=submit]");
    button.disabled = true;
    const basePath = `/api/patient/care-requests/${encodeURIComponent(requestId)}`;
    try {
      await patientRequest(`${basePath}/${conversation === "doctor" ? "doctor-messages" : "messages"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: new FormData(replyForm).get("message") }) });
      replyForm.reset();
      await loadConversation();
      reportStatus("Ubutumwa bwawe burungitswe neza.");
    } catch (error) { reportStatus(error.message, true); }
    finally { button.disabled = false; }
  });
  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    const button = loginForm.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await getCsrfToken();
      const result = await patientRequest("/api/patient/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(loginForm).entries())) });
      csrfToken = result.csrfToken;
      loginForm.reset();
      reportStatus("");
      showPatientPortal(result.patient);
    } catch (error) { reportStatus(error.message, true); }
    finally { button.disabled = false; }
  });
  (async () => {
    try {
      await getCsrfToken();
      const result = await apiRequest("/api/patient/session");
      showPatientPortal(result.patient);
    } catch (error) {
      loginPanel.hidden = false;
      dashboard.hidden = true;
      page.classList.add("patient-message-login-page");
      if (error.message !== "Patient sign-in required.") reportStatus(error.message, true);
    }
  })();
}

function setupStaffAccess() {
  const loginForm = $("#staffLoginForm");
  if (!loginForm || !$("#staffDashboard")) return;
  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    const credentials = Object.fromEntries(new FormData(loginForm).entries());
    try {
      await getCsrfToken();
      const expectedRole = document.body.dataset.staffRole || "pharmacist";
      const result = await adminRequest("/api/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...credentials, role: expectedRole })
      });
      csrfToken = result.csrfToken;
      loginForm.reset();
      showStaffDashboard(result.staff);
      await reloadStaffData();
      focusRequestedContentForm();
      setStatus("Winjiye neza.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });
  const logoutButton = $("#staffLogout");
  if (logoutButton) logoutButton.addEventListener("click", async () => {
    try {
      await adminRequest("/api/staff/logout", { method: "POST" });
      csrfToken = "";
      products = [];
      showStaffLogin();
      setStatus("Wasohotse neza.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });
  loadStaffSession();
}

function formatCurrency(value) {
  return `${Number(value).toLocaleString("fr-FR")} ${cfg.currency || "BIF"}`;
}

function orderStatusLabel(status) {
  return ({
    pending: "Irindiriye kwemezwa",
    confirmed: "Yemejwe",
    ready: "Yateguwe",
    completed: "Yarangiye",
    cancelled: "Yahagaritswe"
  })[status] || status;
}

async function loadAdminData() {
  if (document.body.dataset.staffRole !== "admin") return;
  const [orders, staff, patients, invitations] = await Promise.all([
    adminRequest("/api/admin/orders"),
    adminRequest("/api/admin/staff"),
    adminRequest("/api/admin/patients"),
    adminRequest("/api/admin/staff/invitations")
  ]);
  renderAdminOrders(orders);
  renderStaffAccounts(staff);
  renderPatientAccounts(patients);
  renderStaffInvitations(invitations);
  const counts = {
    "#adminOrderCount": orders.length,
    "#adminPendingCount": `${orders.filter(order => order.status === "pending").length} arindiriye`,
    "#adminStaffCount": staff.length,
    "#adminPatientCount": patients.length,
    "#adminProductCount": products.length,
    "#adminSideOrderCount": orders.filter(order => order.status === "pending").length,
    "#adminSideStaffCount": staff.length,
    "#adminSidePatientCount": patients.length,
    "#quickOrderCount": orders.filter(order => order.status === "pending").length
  };
  Object.entries(counts).forEach(([selector, value]) => {
    const element = $(selector);
    if (element) element.textContent = String(value);
  });
}

function renderAdminOrders(orders) {
  const list = $("#adminOrders");
  if (!list) return;
  list.innerHTML = orders.length ? orders.map(order => {
    const transitions = {
      pending: [["confirmed", "Emeza"], ["cancelled", "Hagarika"]],
      confirmed: [["ready", "Tegura"], ["cancelled", "Hagarika"]],
      ready: [["completed", "Rangiza"]],
      completed: [],
      cancelled: []
    }[order.status];
    return `
      <article class="admin-list-item">
        <div class="admin-item-heading"><b>${escapeHtml(order.full_name)} · ${formatCurrency(order.total_bif)}</b><span class="status-pill">${escapeHtml(orderStatusLabel(order.status))}</span></div>
        <small>${escapeHtml(order.email)} · ${escapeHtml(order.phone)} · ${escapeHtml(new Date(order.created_at).toLocaleString())}</small>
        <p>${order.items.map(item => `${escapeHtml(item.product_name)} × ${item.quantity}`).join(" · ")}</p>
        ${transitions.length ? `<div class="admin-actions">${transitions.map(([status, label]) => `<button type="button" class="btn btn-outline" data-order-id="${escapeHtml(order.id)}" data-order-status="${status}">${label}</button>`).join("")}</div>` : ""}
      </article>
    `;
  }).join("") : '<p class="empty-state">Nta mabwirizwa ahari.</p>';
  list.querySelectorAll("[data-order-id]").forEach(button => button.addEventListener("click", async () => {
    try {
      await adminRequest(`/api/admin/orders/${encodeURIComponent(button.dataset.orderId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: button.dataset.orderStatus })
      });
      await loadAdminData();
      setStatus("Igihe c'ibwirizwa cahinduwe.");
    } catch (error) {
      setStatus(error.message, true);
    }
  }));
}

function renderStaffAccounts(staff) {
  const list = $("#adminStaff");
  if (!list) return;
  list.innerHTML = staff.length ? staff.map(account => `
    <article class="admin-list-item admin-account-item">
      <div><b>${escapeHtml(account.username)}</b><small>${account.role === "admin" ? "Umuyobozi" : account.role === "doctor" ? "Umuganga" : "Umufarumasiye"} · ${account.is_active ? "Irakora" : "Yahagaritswe"}</small></div>
      <button type="button" class="btn btn-outline" data-staff-id="${escapeHtml(account.id)}" data-staff-active="${!account.is_active}">${account.is_active ? "Hagarika" : "Subizaho"}</button>
    </article>
  `).join("") : '<p class="empty-state">Nta bakozi babonetse.</p>';
  list.querySelectorAll("[data-staff-id]").forEach(button => button.addEventListener("click", async () => {
    try {
      await adminRequest(`/api/admin/staff/${encodeURIComponent(button.dataset.staffId)}/active`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: button.dataset.staffActive === "true" })
      });
      await loadAdminData();
      setStatus("Konti y'umukozi yahinduwe.");
    } catch (error) {
      setStatus(error.message, true);
    }
  }));
}

function renderStaffInvitations(invitations) {
  const list = $("#adminInvitations");
  if (!list) return;
  list.innerHTML = invitations.length ? invitations.map(invitation => `
    <article class="admin-list-item admin-account-item">
      <div><b>${escapeHtml(invitation.email)}</b><small>${invitation.role === "admin" ? "Umuyobozi" : invitation.role === "doctor" ? "Umuganga" : "Umufarumasiye"} · Birangira ${escapeHtml(new Date(invitation.expires_at).toLocaleString())}</small></div>
      <button type="button" class="btn btn-outline" data-delete-invitation="${escapeHtml(invitation.id)}">Siba ubutumire</button>
    </article>
  `).join("") : '<p class="empty-state">Nta butumire burindiriye.</p>';
  list.querySelectorAll("[data-delete-invitation]").forEach(button => button.addEventListener("click", async () => {
    const invitation = invitations.find(item => item.id === button.dataset.deleteInvitation);
    if (!invitation || !confirm(`Urashaka gusiba ubutumire bwa ${invitation.email}?`)) return;
    try {
      await adminRequest(`/api/admin/staff/invitations/${encodeURIComponent(invitation.id)}`, { method: "DELETE" });
      await loadAdminData();
      setStatus("Ubutumire busibwe. Ushobora gusubira gutumira iyi email.");
    } catch (error) {
      setStatus(error.message, true);
    }
  }));
}

function renderPatientAccounts(patients) {
  const list = $("#adminPatients");
  if (!list) return;
  list.innerHTML = patients.length ? patients.map(patient => `
    <article class="admin-list-item admin-account-item">
      <div><b>${escapeHtml(patient.full_name)}</b><small>${escapeHtml(patient.email)} · ${escapeHtml(patient.phone)} · ${patient.order_count} amabwirizwa · ${patient.is_active ? "Irakora" : "Yahagaritswe"}</small></div>
      <button type="button" class="btn btn-outline" data-patient-id="${escapeHtml(patient.id)}" data-patient-active="${!patient.is_active}">${patient.is_active ? "Hagarika" : "Subizaho"}</button>
    </article>
  `).join("") : '<p class="empty-state">Nta barwayi biyandikishije.</p>';
  list.querySelectorAll("[data-patient-id]").forEach(button => button.addEventListener("click", async () => {
    try {
      await adminRequest(`/api/admin/patients/${encodeURIComponent(button.dataset.patientId)}/active`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: button.dataset.patientActive === "true" })
      });
      await loadAdminData();
      setStatus("Konti y'umurwayi yahinduwe.");
    } catch (error) {
      setStatus(error.message, true);
    }
  }));
}

function setupAdminDashboard() {
  const menuToggle = $("#adminMenuToggle");
  if (menuToggle) {
    menuToggle.addEventListener("click", () => {
      const open = document.body.classList.toggle("admin-menu-open");
      menuToggle.setAttribute("aria-expanded", String(open));
    });
  }
  document.querySelectorAll(".admin-side-nav a").forEach(link => {
    link.addEventListener("click", () => {
      document.body.classList.remove("admin-menu-open");
      if (menuToggle) menuToggle.setAttribute("aria-expanded", "false");
    });
  });
  const currentTime = $("#adminCurrentTime");
  if (currentTime) {
    const updateTime = () => {
      currentTime.textContent = `◷  None: ${new Intl.DateTimeFormat("en-GB", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
      }).format(new Date())}`;
    };
    updateTime();
    window.setInterval(updateTime, 60_000);
  }
  const form = $("#staffAccountForm");
  if (!form) return;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const details = Object.fromEntries(new FormData(form).entries());
    try {
      await adminRequest("/api/admin/staff/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(details)
      });
      form.reset();
      $("#newStaffRole").value = "pharmacist";
      await loadAdminData();
      setStatus("Ubutumire burungitswe kuri email y'umukozi.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });
}

function setupPharmacistDashboard() {
  const tabs = [...document.querySelectorAll("[data-pharmacist-panel]")];
  const menuToggle = $("#pharmacistMenuToggle");
  if (menuToggle) {
    menuToggle.addEventListener("click", () => {
      const open = document.body.classList.toggle("admin-menu-open");
      menuToggle.setAttribute("aria-expanded", String(open));
    });
  }
  document.querySelectorAll(".admin-side-nav a").forEach(link => link.addEventListener("click", () => {
    document.body.classList.remove("admin-menu-open");
    if (menuToggle) menuToggle.setAttribute("aria-expanded", "false");
  }));
  if (!tabs.length) return;
  const panelNames = ["inventory", "news", "activity", "careRequests"];
  const selectPanel = name => {
    panelNames.forEach(panelName => {
      const panel = $(`#pharmacistPanel${panelName[0].toUpperCase()}${panelName.slice(1)}`);
      if (panel) panel.hidden = panelName !== name;
    });
    document.querySelectorAll(".admin-side-link[data-pharmacist-panel]").forEach(link => {
      link.classList.toggle("active", link.dataset.pharmacistPanel === name);
    });
    document.body.classList.remove("admin-menu-open");
    const menuToggle = $("#pharmacistMenuToggle");
    if (menuToggle) menuToggle.setAttribute("aria-expanded", "false");
  };
  tabs.forEach(tab => tab.addEventListener("click", () => selectPanel(tab.dataset.pharmacistPanel)));
}

function setNewsForm(article = null) {
  const form = $("#newsForm");
  if (!form) return;
  form.reset();
  const settings = readContentSettings();
  $("#newsId").value = article?.id || "";
  $("#newsTitle").value = article?.title || "";
  $("#newsSummary").value = article?.summary || "";
  $("#newsCategory").value = article?.category || readContentSettings().defaultCategory;
  $("#newsCoverImageUrl").value = article?.image_url || article?.cover_image_url || "";
  setNewsCoverPreview($("#newsCoverImageUrl").value);
  $("#newsEditor").innerHTML = article?.body || "";
  const scheduledAt = article?.scheduled_at || article?.scheduledAt;
  $("#newsScheduleAt").value = scheduledAt
    ? new Date(new Date(scheduledAt).getTime() - new Date(scheduledAt).getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    : "";
  $("#newsPageWidth").value = settings.pageWidth;
  $("#newsPageMargins").value = settings.pageMargins;
  $("#newsEditorPage").className = `news-editor-page news-page-${settings.pageWidth} news-margin-${settings.pageMargins}`;
  $("#newsPageMargins").addEventListener("change", event => {
    $("#newsEditorPage").className = `news-editor-page news-page-${readContentSettings().pageWidth} news-margin-${event.target.value}`;
    try {
      localStorage.setItem(contentSettingsKey(), JSON.stringify({ ...readContentSettings(), pageMargins: event.target.value }));
    } catch (error) {
      console.error("Could not save the editor margins.", error);
    }
  });
  newsEditingStatus = article?.status || "draft";
  $("#newsEditorHeading").textContent = article ? "Hindura inkuru" : "Andika amakuru mashasha";
  $("#newsAutosaveState").textContent = newsEditingStatus === "published" ? "Iyi nkuru irasohowe" : "Autosave irakora";
  updateNewsWordCount();
}

function setNewsCoverPreview(url = "") {
  const preview = $("#newsCoverPreview");
  const remove = $("#removeNewsCover");
  if (!preview || !remove) return;
  preview.hidden = !url;
  remove.hidden = !url;
  if (url) preview.src = productImageUrl(url);
  else preview.removeAttribute("src");
}

function updateNewsWordCount() {
  const editor = $("#newsEditor");
  if (!editor) return;
  const text = editor.innerText.trim();
  $("#newsWordCount").textContent = String(text ? text.split(/\s+/).length : 0);
  $("#newsCharacterCount").textContent = String(text.length);
}

function newsDraftStorageKey() {
  return `ubuzimaNewsDraft:${document.body.dataset.staffRole || "staff"}`;
}

function saveNewsDraftLocally() {
  try {
    localStorage.setItem(newsDraftStorageKey(), JSON.stringify({
      id: $("#newsId").value,
      title: $("#newsTitle").value,
      summary: $("#newsSummary").value,
      category: $("#newsCategory").value,
      image_url: $("#newsCoverImageUrl").value,
      body: $("#newsEditor").innerHTML,
      scheduledAt: $("#newsScheduleAt").value,
      status: newsEditingStatus
    }));
    $("#newsAutosaveState").textContent = "Saved on this device";
  } catch (error) {
    console.error("Could not save the local news draft.", error);
    $("#newsAutosaveState").textContent = "Autosave ntiyashobotse";
  }
}

function rememberNewsEditorSelection() {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if ($("#newsEditor")?.contains(range.commonAncestorContainer)) savedNewsSelection = range.cloneRange();
}

function restoreNewsEditorSelection() {
  if (!savedNewsSelection) return;
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(savedNewsSelection);
}

function applyNewsEditorCommand(command, value = null) {
  const editor = $("#newsEditor");
  if (!editor) return;
  editor.focus();
  restoreNewsEditorSelection();
  document.execCommand("styleWithCSS", false, "true");
  document.execCommand(command, false, value);
  rememberNewsEditorSelection();
  updateNewsWordCount();
  saveNewsDraftLocally();
}

function scheduleNewsAutosave() {
  updateNewsWordCount();
  saveNewsDraftLocally();
  window.clearTimeout(newsAutosaveTimer);
  if (newsEditingStatus !== "draft" && $("#newsId").value) return;
  const title = $("#newsTitle").value.trim();
  const summary = $("#newsSummary").value.trim();
  const body = $("#newsEditor").innerText.trim();
  if (!title || !summary || !body) return;
  $("#newsAutosaveState").textContent = "Saving draft…";
  newsAutosaveTimer = window.setTimeout(() => saveNewsArticle("draft", true), 1400);
}

async function saveNewsArticle(status, silent = false) {
  window.clearTimeout(newsAutosaveTimer);
  const form = $("#newsForm");
  if (!form || !form.reportValidity()) return false;
  const body = $("#newsEditor").innerHTML.trim();
  if (!$("#newsEditor").innerText.trim()) {
    setStatus("Andika umubiri w'inkuru imbere yo kubika.", true);
    return false;
  }
  const scheduledAt = $("#newsScheduleAt").value;
  if (status === "scheduled" && (!scheduledAt || new Date(scheduledAt) <= new Date())) {
    setStatus("Hitamwo umusi w'ahazohera uza hanyuma.", true);
    $("#newsScheduleAt").focus();
    return false;
  }
  const articleId = $("#newsId").value;
  const payload = {
    title: $("#newsTitle").value.trim(),
    summary: $("#newsSummary").value.trim(),
    category: $("#newsCategory").value,
    image_url: $("#newsCoverImageUrl").value.trim(),
    body,
    status,
    scheduled_at: status === "scheduled" ? new Date(scheduledAt).toISOString() : ""
  };
  try {
    const result = await adminRequest(articleId ? `/api/staff/news/${encodeURIComponent(articleId)}` : "/api/staff/news", {
      method: articleId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const article = result.article || result;
    $("#newsId").value = article.id;
    newsEditingStatus = article.status || status;
    try { localStorage.removeItem(newsDraftStorageKey()); } catch (error) { console.error("Could not clear the local news draft.", error); }
    $("#newsAutosaveState").textContent = `Saved · ${newsEditingStatus}`;
    await loadStaffNews();
    if (!silent) {
      const message = status === "published"
        ? result.newsletter?.status === "not_configured"
          ? "Inkuru yasohowe; email ntirateguwe. Shira SMTP canke Resend kugira wohereze ku biyandikishije."
          : "Inkuru yasohowe neza."
        : status === "scheduled" ? "Inkuru yashizwe ku rutonde rwo gusohoka."
          : status === "archived" ? "Inkuru yashizwe mu bubiko."
            : status === "pending_review" ? "Inkuru yarungitswe kugira isuzumwe."
            : "Draft yabitswe neza.";
      setStatus(message);
    }
    return true;
  } catch (error) {
    $("#newsAutosaveState").textContent = "Save failed";
    if (!silent) setStatus(error.message, true);
    else console.error("Could not autosave the news draft.", error);
    return false;
  }
}

function renderStaffNews(articles) {
  const list = $("#staffNewsList");
  if (!list) return;
  staffNewsArticles = articles;
  const filter = document.querySelector("[data-news-filter].active")?.dataset.newsFilter || "all";
  const filtered = filter === "all" ? articles : articles.filter(article => article.status === filter);
  const statusLabels = { draft: "Draft", pending_review: "Pending review", scheduled: "Scheduled", published: "Published", archived: "Archived" };
  list.innerHTML = filtered.length ? filtered.map(article => {
    const canManage = currentStaff?.role === "admin" || article.author === currentStaff?.username;
    const canPublish = currentStaff?.role === "admin" || article.status !== "pending_review";
    const date = article.status === "scheduled" ? article.scheduled_at : article.published_at || article.updated_at;
    return `
      <article class="cms-library-item">
        <div class="cms-library-item-top"><span class="cms-status-badge cms-status-${escapeHtml(article.status)}">${escapeHtml(statusLabels[article.status] || article.status)}</span><small>${escapeHtml(new Date(date).toLocaleDateString())}</small></div>
        <h3>${escapeHtml(article.title)}</h3><p>${escapeHtml(article.summary)}</p>
        <div class="cms-library-meta"><span>${escapeHtml(article.category)}</span><span>${Number(article.views_count) || 0} views</span></div>
        ${canManage ? `<div class="cms-item-actions"><button type="button" data-edit-news="${escapeHtml(article.id)}">Edit</button>${article.status === "published" ? `<button type="button" data-notify-news="${escapeHtml(article.id)}">Email</button><button type="button" data-archive-news="${escapeHtml(article.id)}">Archive</button>` : canPublish ? `<button type="button" data-publish-news="${escapeHtml(article.id)}">Publish</button>` : ""}<button type="button" class="cms-danger-action" data-delete-news="${escapeHtml(article.id)}">Delete</button></div>` : ""}
      </article>
    `;
  }).join("") : '<p class="empty-state">Nta makuru yatangajwe.</p>';
  $("#newsLibraryCount").textContent = String(filtered.length);
  $("#newsPublishedCount").textContent = String(articles.filter(article => article.status === "published").length);
  $("#newsDraftCount").textContent = String(articles.filter(article => article.status === "draft").length);
  $("#newsPendingCount").textContent = String(articles.filter(article => article.status === "pending_review").length);
  $("#newsViewsCount").textContent = String(articles.reduce((total, article) => total + (Number(article.views_count) || 0), 0));
}

async function loadStaffNews() {
  if (!$("#staffNewsList")) return;
  const articles = await adminRequest("/api/staff/news");
  renderStaffNews(articles);
  const newsCount = $("#pharmacistNewsCount");
  if (newsCount) newsCount.textContent = String(articles.filter(article => article.status === "published").length);
}

function setupStaffNews() {
  const form = $("#newsForm");
  if (!form) return;
  const editor = $("#newsEditor");
  const settings = readContentSettings();
  const autosaveSetting = settings.autosave;
  $("#submitNewsReview").hidden = document.body.dataset.staffRole !== "pharmacist";
  $("#newsPageWidth").value = settings.pageWidth;
  $("#newsPageMargins").value = settings.pageMargins;
  $("#newsEditorPage").className = `news-editor-page news-page-${settings.pageWidth} news-margin-${settings.pageMargins}`;
  $("#newNewsArticle").addEventListener("click", () => {
    setNewsForm();
    $("#newsTitle").focus();
  });
  $("#chooseNewsCover").addEventListener("click", () => $("#newsCoverImage").click());
  $("#removeNewsCover").addEventListener("click", () => {
    $("#newsCoverImageUrl").value = "";
    $("#newsCoverImage").value = "";
    setNewsCoverPreview();
    (autosaveSetting ? scheduleNewsAutosave : saveNewsDraftLocally)();
  });
  $("#newsCoverImage").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setStatus("Hitamwo JPEG, PNG canke WebP itarenza 5 MB.", true);
      event.target.value = "";
      return;
    }
    const button = $("#chooseNewsCover");
    button.disabled = true;
    button.textContent = "Turiko turashiramwo...";
    try {
      const data = new FormData();
      data.set("image", file);
      const result = await adminRequest("/api/staff/content/images", { method: "POST", body: data });
      $("#newsCoverImageUrl").value = result.image_url;
      setNewsCoverPreview(result.image_url);
      setStatus("Ifoto y'ikarata yongewe neza.");
      (autosaveSetting ? scheduleNewsAutosave : saveNewsDraftLocally)();
    } catch (error) {
      setStatus(error.message || "Ntivyashobotse gushiramwo ifoto.", true);
    } finally {
      button.disabled = false;
      button.textContent = "Hitamwo ifoto";
      event.target.value = "";
    }
  });
  ["newsTitle", "newsSummary", "newsCategory", "newsScheduleAt"].forEach(id => {
    $(`#${id}`).addEventListener("input", autosaveSetting ? scheduleNewsAutosave : saveNewsDraftLocally);
    $(`#${id}`).addEventListener("change", autosaveSetting ? scheduleNewsAutosave : saveNewsDraftLocally);
  });
  editor.addEventListener("input", autosaveSetting ? scheduleNewsAutosave : saveNewsDraftLocally);
  editor.addEventListener("mouseup", rememberNewsEditorSelection);
  editor.addEventListener("keyup", rememberNewsEditorSelection);
  document.querySelectorAll("[data-editor-command]").forEach(button => {
    button.addEventListener("mousedown", event => event.preventDefault());
    button.addEventListener("click", () => applyNewsEditorCommand(button.dataset.editorCommand));
  });
  $("#newsBlockStyle").addEventListener("change", event => applyNewsEditorCommand("formatBlock", event.target.value));
  $("#newsFontFamily").addEventListener("change", event => applyNewsEditorCommand("fontName", event.target.value));
  $("#newsFontSize").addEventListener("change", event => {
    applyNewsEditorCommand("fontSize", "7");
    editor.querySelectorAll('font[size="7"]').forEach(font => {
      const span = document.createElement("span");
      span.style.fontSize = `${event.target.value}px`;
      span.innerHTML = font.innerHTML;
      font.replaceWith(span);
    });
  });
  $("#newsTextColor").addEventListener("input", event => applyNewsEditorCommand("foreColor", event.target.value));
  $("#newsHighlightColor").addEventListener("input", event => applyNewsEditorCommand("hiliteColor", event.target.value));
  $("#newsLineSpacing").addEventListener("change", event => {
    restoreNewsEditorSelection();
    const selection = window.getSelection();
    const block = selection?.anchorNode?.nodeType === Node.TEXT_NODE ? selection.anchorNode.parentElement?.closest("p,h1,h2,h3,h4,li,blockquote") : selection?.anchorNode?.closest?.("p,h1,h2,h3,h4,li,blockquote");
    if (block && editor.contains(block)) block.style.lineHeight = event.target.value;
    scheduleNewsAutosave();
  });
  $("#newsPageWidth").addEventListener("change", event => {
    $("#newsEditorPage").className = `news-editor-page news-page-${event.target.value} news-margin-${readContentSettings().pageMargins}`;
    try {
      localStorage.setItem(contentSettingsKey(), JSON.stringify({ ...readContentSettings(), pageWidth: event.target.value }));
    } catch (error) {
      console.error("Could not save the editor page width.", error);
    }
  });
  $("#insertNewsLink").addEventListener("click", () => {
    const url = prompt("Shiramwo link ya HTTPS:");
    if (!url) return;
    try {
      const parsed = new URL(url);
      if (!["https:", "mailto:"].includes(parsed.protocol)) throw new Error("Link must use HTTPS or email.");
      applyNewsEditorCommand("createLink", parsed.href);
    } catch (error) { setStatus(error.message || "Shiramwo link yemewe.", true); }
  });
  $("#insertNewsTable").addEventListener("click", () => {
    const rows = Math.max(2, Math.min(8, Number(prompt("Rows (2-8):", "3")) || 0));
    const columns = Math.max(2, Math.min(8, Number(prompt("Columns (2-8):", "3")) || 0));
    const table = `<table><tbody>${Array.from({ length: rows }, () => `<tr>${Array.from({ length: columns }, () => "<td>&nbsp;</td>").join("")}</tr>`).join("")}</tbody></table><p><br></p>`;
    applyNewsEditorCommand("insertHTML", table);
  });
  $("#insertNewsRule").addEventListener("click", () => applyNewsEditorCommand("insertHorizontalRule"));
  $("#insertNewsImage").addEventListener("click", () => $("#newsImageUpload").click());
  $("#newsImageUpload").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setStatus("Hitamwo JPEG, PNG canke WebP itarenza 5 MB.", true);
      event.target.value = "";
      return;
    }
    try {
      const data = new FormData();
      data.set("image", file);
      const result = await adminRequest("/api/staff/content/images", { method: "POST", body: data });
      applyNewsEditorCommand("insertImage", productImageUrl(result.image_url));
      setStatus("Ifoto yongewe mu nkuru.");
    } catch (error) { setStatus(error.message, true); }
    event.target.value = "";
  });
  $("#saveNewsDraft").addEventListener("click", () => saveNewsArticle("draft"));
  $("#submitNewsReview").addEventListener("click", () => saveNewsArticle("pending_review"));
  $("#publishNews").addEventListener("click", () => saveNewsArticle("published"));
  $("#scheduleNews").addEventListener("click", () => saveNewsArticle("scheduled"));
  $("#previewNews").addEventListener("click", async () => {
    if (!form.reportValidity() || !editor.innerText.trim()) return setStatus("Uzuza umutwe, incamake n'inkuru imbere yo kuraba.", true);
    try {
      const body = await adminRequest("/api/staff/news/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: $("#newsTitle").value, summary: $("#newsSummary").value, category: $("#newsCategory").value, body: editor.innerHTML })
      });
      $("#newsPreviewTitle").textContent = $("#newsTitle").value;
      $("#newsPreviewSummary").textContent = $("#newsSummary").value;
      $("#newsPreviewBody").innerHTML = body.body;
      $("#newsPreviewDialog").showModal();
    } catch (error) { setStatus(error.message, true); }
  });
  document.querySelectorAll("[data-news-filter]").forEach(button => button.addEventListener("click", () => {
    document.querySelectorAll("[data-news-filter]").forEach(item => item.classList.toggle("active", item === button));
    renderStaffNews(staffNewsArticles);
  }));
  $("#staffNewsList").addEventListener("click", async event => {
    const button = event.target.closest("button");
    if (!button) return;
    const article = staffNewsArticles.find(item => item.id === (button.dataset.editNews || button.dataset.publishNews || button.dataset.archiveNews || button.dataset.deleteNews || button.dataset.notifyNews));
    if (button.dataset.editNews && article) {
      setNewsForm(article);
      $("#newsTitle").focus();
      return;
    }
    if (button.dataset.publishNews && article) {
      setNewsForm(article);
      await saveNewsArticle("published");
      return;
    }
    if (button.dataset.archiveNews && article) {
      setNewsForm(article);
      await saveNewsArticle("archived");
      return;
    }
    if (button.dataset.deleteNews && article && confirm("Urashaka gukuraho iyi nkuru?")) {
      try {
        await adminRequest(`/api/staff/news/${encodeURIComponent(article.id)}`, { method: "DELETE" });
        await loadStaffNews();
        setStatus("Inkuru yakuwemwo.");
      } catch (error) { setStatus(error.message, true); }
    }
    if (button.dataset.notifyNews && article) {
      try {
        const result = await adminRequest(`/api/staff/news/${encodeURIComponent(article.id)}/notify`, { method: "POST" });
        setStatus(`Email zoherejwe: ${result.newsletter.sent}; zananiranye: ${result.newsletter.failed}.`);
      } catch (error) { setStatus(error.message, true); }
    }
  });
  $("#newsEditorPage").addEventListener("paste", () => window.setTimeout(scheduleNewsAutosave, 0));
  try {
    const localDraft = JSON.parse(localStorage.getItem(newsDraftStorageKey()) || "null");
    if (localDraft?.title || localDraft?.body) setNewsForm(localDraft);
    else setNewsForm();
  } catch (error) {
    console.error("Could not restore the local news draft.", error);
    setNewsForm();
  }
}

function videoEmbedUrl(video) {
  if (!video?.video_url || !["youtube", "vimeo"].includes(video.source_type)) return "";
  try {
    const url = new URL(video.video_url);
    if (video.source_type === "youtube") {
      const id = url.hostname.endsWith("youtu.be")
        ? url.pathname.slice(1)
        : url.searchParams.get("v") || url.pathname.split("/").filter(Boolean).pop();
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : "";
    }
    if (video.source_type === "vimeo") {
      const id = url.pathname.split("/").filter(Boolean).pop();
      return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : "";
    }
  } catch {}
  return "";
}

function renderVideoPreview(container, video, preview = false) {
  if (!container) return;
  const embedUrl = videoEmbedUrl(video);
  if (video.source_type === "upload" && video.video_url) {
    container.innerHTML = `<video controls preload="metadata" ${video.thumbnail_url ? `poster="${escapeHtml(productImageUrl(video.thumbnail_url))}"` : ""} src="${escapeHtml(productImageUrl(video.video_url))}"></video>`;
  } else if (embedUrl) {
    container.innerHTML = `<iframe src="${escapeHtml(embedUrl)}" title="${escapeHtml(video.title || "Ubuzima video")}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
  } else {
    container.innerHTML = `<span>${preview ? "Hitamwo video canke ushiremwo link yemewe." : "Video ntiyabonetse."}</span>`;
  }
}

function setStaffVideoForm(video = null) {
  const form = $("#videoForm");
  if (!form) return;
  if (staffVideoPreviewUrl) URL.revokeObjectURL(staffVideoPreviewUrl);
  staffVideoPreviewUrl = "";
  form.reset();
  $("#staffVideoId").value = video?.id || "";
  $("#staffVideoTitle").value = video?.title || "";
  $("#staffVideoDescription").value = video?.description || "";
  $("#staffVideoCategory").value = video?.category || "";
  $("#staffVideoSource").value = video?.source_type || "upload";
  $("#staffVideoCurrentUrl").value = video?.video_url || "";
  $("#staffVideoUrl").value = video?.source_type === "upload" ? "" : video?.video_url || "";
  $("#staffVideoThumbnailUrl").value = video?.thumbnail_url || "";
  $("#staffVideoStatus").value = video?.status || "draft";
  $("#staffVideoSchedule").value = video?.scheduled_at
    ? new Date(new Date(video.scheduled_at).getTime() - new Date(video.scheduled_at).getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    : "";
  $("#videoEditorHeading").textContent = video ? "Hindura video" : "Shiramwo video nshasha";
  updateVideoSourceFields();
  renderVideoPreview($("#staffVideoPreview"), video || {}, true);
}

function updateVideoSourceFields() {
  const external = $("#staffVideoSource").value !== "upload";
  $("#videoUploadFields").hidden = external;
  $("#videoEmbedFields").hidden = !external;
}

function renderStaffVideos(videos) {
  const list = $("#staffVideosList");
  if (!list) return;
  staffVideos = videos;
  const filter = document.querySelector("[data-video-filter].active")?.dataset.videoFilter || "all";
  const filtered = filter === "all" ? videos : videos.filter(video => video.status === filter);
  const labels = { draft: "Draft", scheduled: "Scheduled", published: "Published", archived: "Archived" };
  $("#videoLibraryCount").textContent = String(filtered.length);
  $("#videoTotalCount").textContent = String(videos.length);
  $("#videoViewsCount").textContent = String(videos.reduce((sum, video) => sum + (Number(video.views_count) || 0), 0));
  $("#videoDraftCount").textContent = String(videos.filter(video => video.status === "draft").length);
  $("#videoPublishedCount").textContent = String(videos.filter(video => video.status === "published").length);
  list.innerHTML = filtered.length ? filtered.map(video => {
    const date = video.status === "scheduled" ? video.scheduled_at : video.published_at || video.updated_at;
    const thumbnail = video.thumbnail_url
      ? `<img src="${escapeHtml(productImageUrl(video.thumbnail_url))}" alt="">`
      : `<div class="cms-video-placeholder"><span>▷</span></div>`;
    const canManage = currentStaff?.role === "admin" || video.author === currentStaff?.username;
    return `<article class="cms-video-card"><div class="cms-video-thumb">${thumbnail}<span class="cms-status-badge cms-status-${escapeHtml(video.status)}">${escapeHtml(labels[video.status] || video.status)}</span></div><div class="cms-video-card-body"><h3>${escapeHtml(video.title)}</h3><p>${escapeHtml(video.description)}</p><div class="cms-library-meta"><span>${escapeHtml(video.category)}</span><span>${Number(video.views_count) || 0} views</span><span>${escapeHtml(new Date(date).toLocaleDateString())}</span></div>${canManage ? `<div class="cms-item-actions"><button type="button" data-edit-video="${escapeHtml(video.id)}">Edit</button>${video.status === "published" ? `<button type="button" data-archive-video="${escapeHtml(video.id)}">Archive</button>` : `<button type="button" data-publish-video="${escapeHtml(video.id)}">Publish</button>`}<button type="button" class="cms-danger-action" data-delete-video="${escapeHtml(video.id)}">Delete</button></div>` : ""}</div></article>`;
  }).join("") : '<p class="empty-state">Nta video muri iki gice.</p>';
}

async function loadStaffVideos() {
  if (!$("#staffVideosList")) return;
  renderStaffVideos(await adminRequest("/api/staff/videos"));
}

async function saveStaffVideo(event) {
  event.preventDefault();
  const form = $("#videoForm");
  if (!form.reportValidity()) return;
  const sourceType = $("#staffVideoSource").value;
  const videoFile = $("#staffVideoFile").files[0];
  const thumbnailFile = $("#staffVideoThumbnail").files[0];
  const status = $("#staffVideoStatus").value;
  const scheduledAt = $("#staffVideoSchedule").value;
  if (sourceType === "upload" && !videoFile && !$("#staffVideoCurrentUrl").value) {
    setStatus("Hitamwo video ya MP4 canke WebM.", true);
    return;
  }
  if (videoFile && (videoFile.size > 100 * 1024 * 1024 || !["video/mp4", "video/webm"].includes(videoFile.type))) {
    setStatus("Video itegerezwa kuba MP4 canke WebM itarenza 100 MB.", true);
    return;
  }
  if (thumbnailFile && (thumbnailFile.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(thumbnailFile.type))) {
    setStatus("Ifoto y'igifuniko itegerezwa kuba JPEG, PNG canke WebP itarenza 5 MB.", true);
    return;
  }
  if (status === "scheduled" && (!scheduledAt || new Date(scheduledAt) <= new Date())) {
    setStatus("Hitamwo umusi w'ahazohera uza hanyuma.", true);
    return;
  }
  try {
    let videoUrl = sourceType === "upload" ? $("#staffVideoCurrentUrl").value : $("#staffVideoUrl").value.trim();
    if (videoFile) {
      const uploadData = new FormData();
      uploadData.set("video", videoFile);
      const uploaded = await adminRequest("/api/staff/videos/upload", { method: "POST", body: uploadData });
      videoUrl = uploaded.video_url;
    }
    let thumbnailUrl = $("#staffVideoThumbnailUrl").value.trim();
    if (thumbnailFile) {
      const imageData = new FormData();
      imageData.set("image", thumbnailFile);
      const uploaded = await adminRequest("/api/staff/content/images", { method: "POST", body: imageData });
      thumbnailUrl = uploaded.image_url;
    }
    const payload = {
      title: $("#staffVideoTitle").value.trim(),
      description: $("#staffVideoDescription").value.trim(),
      category: $("#staffVideoCategory").value.trim(),
      source_type: sourceType,
      video_url: videoUrl,
      thumbnail_url: thumbnailUrl,
      status,
      scheduled_at: status === "scheduled" ? new Date(scheduledAt).toISOString() : ""
    };
    const id = $("#staffVideoId").value;
    await adminRequest(id ? `/api/staff/videos/${encodeURIComponent(id)}` : "/api/staff/videos", {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    form.reset();
    setStaffVideoForm();
    await loadStaffVideos();
    setStatus(status === "published" ? "Video yasohowe neza." : status === "scheduled" ? "Video yashizwe ku rutonde rwo gusohoka." : "Video yabitswe neza.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

function setupStaffVideos() {
  const form = $("#videoForm");
  if (!form) return;
  form.addEventListener("submit", saveStaffVideo);
  $("#newStaffVideo").addEventListener("click", () => {
    setStaffVideoForm();
    $("#staffVideoTitle").focus();
  });
  $("#resetStaffVideo").addEventListener("click", () => setStaffVideoForm());
  $("#staffVideoSource").addEventListener("change", updateVideoSourceFields);
  $("#staffVideoFile").addEventListener("change", event => {
    const file = event.target.files[0];
    if (staffVideoPreviewUrl) URL.revokeObjectURL(staffVideoPreviewUrl);
    staffVideoPreviewUrl = "";
    if (!file) return renderVideoPreview($("#staffVideoPreview"), { source_type: "upload", video_url: $("#staffVideoCurrentUrl").value }, true);
    staffVideoPreviewUrl = URL.createObjectURL(file);
    $("#staffVideoPreview").innerHTML = `<video controls src="${escapeHtml(staffVideoPreviewUrl)}"></video>`;
  });
  $("#staffVideoUrl").addEventListener("input", () => renderVideoPreview($("#staffVideoPreview"), {
    title: $("#staffVideoTitle").value,
    source_type: $("#staffVideoSource").value,
    video_url: $("#staffVideoUrl").value
  }, true));
  $("#staffVideoThumbnailUrl").addEventListener("input", event => {
    const video = { source_type: $("#staffVideoSource").value, video_url: $("#staffVideoUrl").value || $("#staffVideoCurrentUrl").value, thumbnail_url: event.target.value };
    if (event.target.value) $("#staffVideoPreview").innerHTML = `<img src="${escapeHtml(event.target.value)}" alt="Video thumbnail preview">`;
  });
  $("#staffVideosList").addEventListener("click", async event => {
    const button = event.target.closest("button");
    if (!button) return;
    const id = button.dataset.editVideo || button.dataset.publishVideo || button.dataset.archiveVideo || button.dataset.deleteVideo;
    const video = staffVideos.find(item => item.id === id);
    if (!video) return;
    if (button.dataset.editVideo) {
      setStaffVideoForm(video);
      $("#staffVideoTitle").focus();
      return;
    }
    if (button.dataset.publishVideo || button.dataset.archiveVideo) {
      setStaffVideoForm(video);
      $("#staffVideoStatus").value = button.dataset.publishVideo ? "published" : "archived";
      form.requestSubmit();
      return;
    }
    if (button.dataset.deleteVideo && confirm("Urashaka gukuraho iyi video?")) {
      try {
        await adminRequest(`/api/staff/videos/${encodeURIComponent(video.id)}`, { method: "DELETE" });
        await loadStaffVideos();
        setStatus("Video yakuwemwo.");
      } catch (error) { setStatus(error.message, true); }
    }
  });
  document.querySelectorAll("[data-video-filter]").forEach(button => button.addEventListener("click", () => {
    document.querySelectorAll("[data-video-filter]").forEach(item => item.classList.toggle("active", item === button));
    renderStaffVideos(staffVideos);
  }));
  setStaffVideoForm();
}

function renderPublicNews(articles, container) {
  const prepared = articles.map(article => {
    const template = document.createElement("template");
    template.innerHTML = article.body || "";
    const firstImage = template.content.querySelector("img");
    const cover = article.cover_image_url || article.image_url || firstImage?.getAttribute("src") || "";
    if (firstImage) firstImage.remove();
    const words = (template.content.textContent || "").trim().split(/\s+/).filter(Boolean).length;
    const topics = [];
    let topic = null;
    Array.from(template.content.children).forEach(node => {
      if (/^H[1-3]$/.test(node.tagName)) {
        topic = { title: node.textContent.trim(), body: "" };
        topics.push(topic);
      } else if (topic && node.textContent.trim()) topic.body += `${node.textContent.trim()} `;
    });
    if (/paracetamol/i.test(article.title || "")) {
      const textTemplate = document.createElement("div");
      textTemplate.innerHTML = template.innerHTML.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/li>/gi, "\n");
      const articleText = (textTemplate.textContent || "").replace(/\s+/g, " ").trim();
      const headings = ["Paracetamol ikora gute?", "Ni izihe ngaruka zo gukoresha paracetamol nabi?", "Ni gute umuntu yokoresha paracetamol neza?"];
      const points = headings.map(heading => articleText.toLowerCase().indexOf(heading.toLowerCase()));
      if (points.every(point => point >= 0)) {
        topics.length = 0;
        topics.push(
          { title: "Paracetamol ikora gute?", body: articleText.slice(0, points[1]) },
          { title: "Ni izihe ngaruka?", body: articleText.slice(points[1], points[2]) },
          { title: "Ni gute kuyikoresha neza?", body: articleText.slice(points[2]) }
        );
      }
    }
    return { ...article, cover, bodyHtml: template.innerHTML, topics: topics.slice(0, 3), readMinutes: Math.max(1, Math.ceil(words / 200)) };
  });
  const first = prepared[0];
  const related = prepared.slice(1, 4);
  container.innerHTML = first ? `
    <nav class="public-news-breadcrumb" aria-label="Breadcrumb"><a href="index.html">⌂</a><span>›</span><a href="news.html">Amakuru</a><span>›</span><span>${escapeHtml(first.category || "Imiti")}</span><span>›</span><b>${escapeHtml(first.title)}</b></nav>
    <div class="public-news-layout">
      <article class="public-news-feature" id="${escapeHtml(first.id)}" data-news-view="${escapeHtml(first.id)}">
        <div class="public-news-hero ${first.cover ? "" : "public-news-hero-fallback"}"><div class="public-news-hero-copy"><span class="public-news-hero-category">✚ &nbsp;${escapeHtml(first.category || "Imiti")}</span><div class="public-news-meta"><span>▦ &nbsp;${escapeHtml(new Date(first.published_at).toLocaleDateString())}</span><i></i><span>◷ &nbsp;${first.readMinutes} min isomwa</span></div><h1>${escapeHtml(first.title)}</h1></div>${first.cover ? `<img src="${escapeHtml(productImageUrl(first.cover))}" alt="">` : /paracetamol/i.test(first.title) ? `<img src="assets/paracetamol-hero.svg" alt="Paracetamol 500 mg and tablets">` : ""}</div>
        <div class="public-news-article-content">
          <div class="public-news-meta"><span>▦ ${escapeHtml(new Date(first.published_at).toLocaleDateString())}</span><i></i><span class="public-news-category">${escapeHtml(first.category || "Ubuzima")}</span><i></i><span>◷ ${first.readMinutes} min isomwa</span></div>
          <p class="public-news-summary">${escapeHtml(first.summary)}</p>
          <button class="public-news-read-all" type="button" data-open-news-story>▤ &nbsp; Soma vyose &nbsp; →</button>
          ${first.topics.length ? `<div class="public-news-topics">${first.topics.map((topic, index) => `<article class="public-news-topic public-news-topic-${index + 1}"><h3><span>${["✓", "!", "✓"][index]}</span><b>${escapeHtml(topic.title)}</b></h3><p>${escapeHtml(topic.body.trim().slice(0, 190) || first.summary)}</p><button class="public-news-topic-more" type="button" data-open-news-topic="${index}">Soma vyinshi →</button></article>`).join("")}</div>` : ""}
        </div>
      </article>
      <aside class="public-news-aside">
        <section class="public-news-aside-card public-news-message"><h2><span>◀</span> Ubutumwa ku Baturage</h2><p>${escapeHtml(first.summary)}</p><strong>Menya amakuru yizewe, ukurikize impanuro z'abaganga n'abafarumasiye.</strong></section>
        <section class="public-news-aside-card public-news-related"><h2><span>▤</span> Ibiganiro bisanzwe</h2>
          ${related.length ? related.map(article => `<a href="#${encodeURIComponent(article.id)}"><span>${article.cover ? `<img src="${escapeHtml(productImageUrl(article.cover))}" alt="" loading="lazy">` : `<i aria-hidden="true">✚</i>`}</span><b>${escapeHtml(article.title)}</b><strong aria-hidden="true">›</strong></a>`).join("") : `<p>Inkuru zindi zizoboneka hano.</p>`}
        </section>
        <section class="public-news-donate"><span aria-hidden="true">♡</span><div><b>Dufatanye kubaka ubuzima bwiza</b><a href="contact.html">Twandikire <strong>→</strong></a></div></section>
      </aside>
    </div>
    ${prepared.length > 1 ? `<section class="public-news-more"><h2>Izindi nkuru</h2><div>${prepared.slice(1).map(article => `<article class="public-news-card" id="${escapeHtml(article.id)}" data-news-view="${escapeHtml(article.id)}">${article.cover ? `<div class="public-news-card-image"><img src="${escapeHtml(productImageUrl(article.cover))}" alt="" loading="lazy"></div>` : ""}<div class="section-kicker">${escapeHtml(article.category || "Ubuzima")} · ${escapeHtml(new Date(article.published_at).toLocaleDateString())} · ${article.readMinutes} min</div><h3>${escapeHtml(article.title)}</h3><p class="news-summary">${escapeHtml(article.summary)}</p><details class="public-news-card-expand"><summary>Soma inkuru</summary><div class="news-body">${article.bodyHtml}</div><small>${escapeHtml(article.author || "UBUZIMA PHARMA")}</small></details></article>`).join("")}</div></section>` : ""}
  ` : '<p class="empty-state">Nta makuru mashasha ahari.</p>';
  const relatedPanel = container.querySelector(".public-news-related");
  if (relatedPanel && !relatedPanel.querySelector("a")) {
    relatedPanel.querySelector("p")?.remove();
    relatedPanel.insertAdjacentHTML("beforeend", `<a href="news.html"><span class="news-related-illustration medicine">✚</span><b>Imiti n'ubuzima</b><strong>›</strong></a><a href="news.html"><span class="news-related-illustration health">＋</span><b>Indwara n'ubuzima</b><strong>›</strong></a><a href="news.html"><span class="news-related-illustration food">✿</span><b>Ubuzima bwiza</b><strong>›</strong></a>`);
  }
  const contactCard = container.querySelector(".public-news-donate");
  if (contactCard) contactCard.outerHTML = `<a class="public-news-contact-card" href="contact.html"><span>✉</span><b>Twandikire kuri<br>ubuzimapharma@gmail.com</b></a>`;
  if (first) {
    const storyDialog = document.createElement("dialog");
    storyDialog.className = "public-news-story-dialog";
    storyDialog.setAttribute("aria-labelledby", "publicNewsStoryTitle");
    storyDialog.innerHTML = `<header><div><span>${escapeHtml(first.category || "Imiti")}</span><h2 id="publicNewsStoryTitle">${escapeHtml(first.title)}</h2></div><button type="button" data-close-news-story aria-label="Funga">×</button></header><p class="public-news-dialog-summary">${escapeHtml(first.summary)}</p><div class="public-news-dialog-body news-body">${first.bodyHtml}</div>${first.video_url ? `<p><a class="text-link" href="${escapeHtml(first.video_url)}" target="_blank" rel="noopener noreferrer">Raba videwo →</a></p>` : ""}<small class="public-news-author">${escapeHtml(first.author || "UBUZIMA PHARMA")}</small>`;
    container.append(storyDialog);
    container.querySelector("[data-open-news-story]")?.addEventListener("click", () => storyDialog.showModal());
    storyDialog.querySelector("[data-close-news-story]").addEventListener("click", () => storyDialog.close());
    storyDialog.addEventListener("click", event => { if (event.target === storyDialog) storyDialog.close(); });
    const topicDialog = document.createElement("dialog");
    topicDialog.className = "public-news-story-dialog public-news-topic-dialog";
    topicDialog.innerHTML = `<header><div><span>${escapeHtml(first.category || "Imiti")}</span><h2></h2></div><button type="button" data-close-news-topic aria-label="Funga">×</button></header><div class="public-news-topic-dialog-body"></div>`;
    container.append(topicDialog);
    container.querySelectorAll("[data-open-news-topic]").forEach(button => button.addEventListener("click", () => {
      const topic = first.topics[Number(button.dataset.openNewsTopic)];
      if (!topic) return;
      topicDialog.querySelector("header h2").textContent = topic.title;
      topicDialog.querySelector(".public-news-topic-dialog-body").textContent = topic.body.trim() || first.summary;
      topicDialog.showModal();
    }));
    topicDialog.querySelector("[data-close-news-topic]").addEventListener("click", () => topicDialog.close());
    topicDialog.addEventListener("click", event => { if (event.target === topicDialog) topicDialog.close(); });
  }
  trackPublicViews(container, "[data-news-view]", id => `/api/news/${encodeURIComponent(id)}/view`);
  const target = window.location.hash ? document.getElementById(decodeURIComponent(window.location.hash.slice(1))) : null;
  if (target && container.contains(target)) target.scrollIntoView();
}
function renderPublicVideos(videos, container) {
  container.innerHTML = videos.length ? videos.map(video => {
    const media = video.source_type === "upload"
      ? `<video controls preload="metadata" ${video.thumbnail_url ? `poster="${escapeHtml(productImageUrl(video.thumbnail_url))}"` : ""} src="${escapeHtml(productImageUrl(video.video_url))}"></video>`
      : `<iframe src="${escapeHtml(videoEmbedUrl(video))}" title="${escapeHtml(video.title)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
    return `<article class="public-video-card" id="${escapeHtml(video.id)}" data-video-view="${escapeHtml(video.id)}"><div class="public-video-media">${media}</div><div class="public-video-copy"><span class="section-kicker">${escapeHtml(video.category)} · ${Number(video.views_count) || 0} views</span><h2>${escapeHtml(video.title)}</h2><p>${escapeHtml(video.description)}</p><small>${escapeHtml(new Date(video.published_at).toLocaleDateString())}</small></div></article>`;
  }).join("") : '<p class="empty-state">Nta mashusho mashasha ahari.</p>';
  trackPublicViews(container, "[data-video-view]", id => `/api/videos/${encodeURIComponent(id)}/view`);
}

function trackPublicViews(container, selector, endpointForId) {
  if (!("IntersectionObserver" in window)) return;
  const observer = new IntersectionObserver(entries => {
    entries.filter(entry => entry.isIntersecting).forEach(async entry => {
      const element = entry.target;
      const id = element.dataset.newsView || element.dataset.videoView;
      const storageKey = `ubuzimaContentView:${id}`;
      observer.unobserve(element);
      try {
        if (sessionStorage.getItem(storageKey)) return;
        await getCsrfToken();
        await adminRequest(endpointForId(id), { method: "POST" });
        sessionStorage.setItem(storageKey, "1");
      } catch (error) {
        console.error("Could not record a content view.", error);
      }
    });
  }, { threshold: 0.35 });
  container.querySelectorAll(selector).forEach(element => observer.observe(element));
}

async function loadPublicNews(container) {
  try {
    renderPublicNews(await apiRequest("/api/news"), container);
  } catch (error) {
    container.innerHTML = `<p class="status-error">${escapeHtml(error.message)}</p>`;
  }
}

async function loadPublicVideos(container) {
  try {
    renderPublicVideos(await apiRequest("/api/videos"), container);
  } catch (error) {
    container.innerHTML = `<p class="status-error">${escapeHtml(error.message)}</p>`;
  }
}

function setupUpdatesPage() {
  const cards = $("#updatesCards");
  if (!cards) return;
  let articles = [];
  let videos = [];
  let activeKind = "news";
  let activeCategory = "All";
  const filters = $("#updatesFilters");
  const search = $("#updatesSearch");
  const buttons = [...document.querySelectorAll("[data-updates-kind]")];
  const refresh = $("#updatesRefresh");

  const render = () => {
    const isVideo = activeKind === "videos";
    const entries = isVideo ? videos : articles;
    const categories = [...new Set(entries.map(item => item.category).filter(Boolean))];
    if (activeKind === "testimonials") {
      filters.innerHTML = "";
      cards.innerHTML = `<a class="updates-contact-card" href="contact.html"><span>♡</span><div><b>Dusangize ubuhamya bwawe</b><small>Turashima ivyiyumviro vyawe. Fyonda hano utwandikire.</small></div><strong>→</strong></a>`;
      return;
    }

    filters.innerHTML = [`All`, ...categories].map(category => `<button class="updates-filter${category === activeCategory ? " active" : ""}" type="button" data-update-category="${escapeHtml(category)}">${category === "All" ? "Vyose" : escapeHtml(category)}</button>`).join("");
    filters.querySelectorAll("[data-update-category]").forEach(button => button.addEventListener("click", () => {
      activeCategory = button.dataset.updateCategory;
      render();
    }));

    const query = (search.value || "").trim().toLocaleLowerCase();
    const visible = entries.filter(item => (activeCategory === "All" || item.category === activeCategory) && (!query || `${item.title} ${item.summary || item.description || ""} ${item.category || ""}`.toLocaleLowerCase().includes(query)));
    cards.innerHTML = visible.length ? visible.map(item => {
      const href = isVideo ? `videos.html#${encodeURIComponent(item.id)}` : `news-library.html#${encodeURIComponent(item.id)}`;
      const image = isVideo ? (item.thumbnail_url || "") : (item.cover_image_url || item.image_url || "");
      const detail = isVideo ? (item.description || "") : (item.summary || "");
      const date = item.published_at ? new Date(item.published_at).toLocaleDateString() : "";
      return `<a class="updates-card" href="${href}">${image ? `<img src="${escapeHtml(productImageUrl(image))}" alt="" loading="lazy">` : `<span class="updates-card-icon">${isVideo ? "▶" : "▤"}</span>`}<div class="updates-card-copy"><small>${escapeHtml(item.category || (isVideo ? "Amashusho" : "Amakuru"))}${date ? ` · ${escapeHtml(date)}` : ""}</small><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(detail)}</p><b>${isVideo ? "Raba amashusho" : "Soma inkuru"} →</b></div></a>`;
    }).join("") : `<p class="updates-empty">${isVideo ? "Nta mashusho mashasha ahari." : "Nta nkuru nshasha ihari."}</p>`;
  };

  const load = async () => {
    cards.innerHTML = '<p class="updates-empty">Turiko turarondera amakuru...</p>';
    const [newsResult, videosResult] = await Promise.allSettled([apiRequest("/api/news"), apiRequest("/api/videos")]);
    articles = newsResult.status === "fulfilled" ? newsResult.value : [];
    videos = videosResult.status === "fulfilled" ? videosResult.value : [];
    render();
  };

  buttons.forEach(button => button.addEventListener("click", () => {
    activeKind = button.dataset.updatesKind;
    activeCategory = "All";
    buttons.forEach(tab => {
      const selected = tab === button;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    const notice = $("#updatesNotice");
    if (notice) notice.textContent = activeKind === "videos" ? "ℹ Amashusho y'inyigisho azoboneka hano." : activeKind === "news" ? "ℹ Inkuru n'inyigisho zizewe ku buzima." : "ℹ Ubuhamya n'ivyiyumviro vy'abatugana.";
    render();
  }));
  search.addEventListener("input", render);
  refresh.addEventListener("click", load);
  load();
}

function setPageStatus(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("status-error", isError);
  element.hidden = !message;
}

function setupNewsAndEmailPages() {
  setupUpdatesPage();
  const publicNewsList = $("#publicNewsList");
  const publicVideoList = $("#publicVideoList");
  if (publicNewsList) loadPublicNews(publicNewsList);
  if (publicVideoList) loadPublicVideos(publicVideoList);

  const newsletterForm = $("#newsletterForm");
  if (newsletterForm) newsletterForm.addEventListener("submit", async event => {
    event.preventDefault();
    const status = $("#newsletterStatus");
    try {
      await getCsrfToken();
      const result = await adminRequest("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: new FormData(newsletterForm).get("email") })
      });
      newsletterForm.reset();
      setPageStatus(status, result.message);
    } catch (error) {
      setPageStatus(status, error.message, true);
    }
  });

  const confirmPage = $("#newsletterConfirmStatus");
  const unsubscribePage = $("#newsletterUnsubscribeStatus");
  const invitePage = $("#staffInviteStatus");
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const confirmForm = $("#newsletterConfirmForm");
  const unsubscribeForm = $("#newsletterUnsubscribeForm");
  const inviteForm = $("#staffInviteForm");
  if (confirmPage && !token) setPageStatus(confirmPage, "Link yo kwemeza ntiyuzuye.", true);
  if (unsubscribePage && !token) setPageStatus(unsubscribePage, "Link yo guhagarika ubutumwa ntiyuzuye.", true);
  if (invitePage && !token) setPageStatus(invitePage, "Ubutumire ntibwuzuye canke bwarangiye.", true);

  for (const [form, endpoint, statusElement, successFallback] of [
    [confirmForm, "/api/newsletter/confirm", confirmPage, "Kwiyandikisha kwemejwe."],
    [unsubscribeForm, "/api/newsletter/unsubscribe", unsubscribePage, "Ubu wahagaritse kwakira amakuru."],
    [inviteForm, "/api/staff/invitations/accept", invitePage, "Ubutumire bwawe bwemejwe."]
  ]) {
    if (!form || !token) continue;
    form.addEventListener("submit", async event => {
      event.preventDefault();
      try {
        await getCsrfToken();
        const body = { token };
        if (form === inviteForm) body.password = new FormData(form).get("password");
        const result = await adminRequest(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        form.hidden = true;
        setPageStatus(statusElement, result.message || successFallback);
        const portal = result.staff?.role === "doctor" ? "/doctor/" : result.staff?.role === "admin" ? "/admin/" : "/pharmacist/";
        if (form === inviteForm) {
          const link = $("#staffInvitePortalLink");
          link.href = portal;
          link.hidden = false;
          link.textContent = result.staff?.role === "doctor" ? "Injira ku rubuga rw'abaganga" : result.staff?.role === "admin" ? "Injira ku rubuga rw'ubuyobozi" : "Injira ku rubuga rw'abafarumasiye";
        }
      } catch (error) {
        setPageStatus(statusElement, error.message, true);
      }
    });
  }
}

function setupContentSettings() {
  const form = $("#contentSettingsForm");
  if (!form) return;
  const settings = readContentSettings();
  $("#contentAutosave").checked = settings.autosave;
  $("#contentDefaultCategory").value = settings.defaultCategory;
  $("#contentDefaultWidth").value = settings.pageWidth;
  $("#contentDefaultMargins").value = settings.pageMargins;
  form.addEventListener("submit", event => {
    event.preventDefault();
    try {
      localStorage.setItem(contentSettingsKey(), JSON.stringify({
        autosave: $("#contentAutosave").checked,
        defaultCategory: $("#contentDefaultCategory").value,
        pageWidth: $("#contentDefaultWidth").value,
        pageMargins: $("#contentDefaultMargins").value
      }));
      setStatus("Igenamiterere zabitswe kuri iki gikoresho.");
    } catch (error) {
      console.error("Could not save content settings.", error);
      setStatus("Ntivyashobotse kubika igenamiterere. Suzuma ububiko bwa browser.", true);
    }
  });
}

function setupPasswordRecoveryPages() {
  const staffLoginForm = $("#staffLoginForm");
  const patientLoginForm = $("#patientLoginForm");
  for (const [form, accountType] of [[staffLoginForm, "staff"], [patientLoginForm, "patient"]]) {
    if (!form) continue;
    if (accountType === "staff" && document.body.dataset.staffRole === "admin") continue;
    const link = document.createElement("a");
    link.className = "text-link";
    link.href = `/forgot-password.html?account_type=${accountType}`;
    link.textContent = "Wibagiye ijambobanga?";
    form.append(link);
  }

  const forgotForm = $("#forgotPasswordForm");
  const resetForm = $("#passwordResetForm");
  const query = new URLSearchParams(window.location.search);
  const accountType = query.get("account_type");
  const token = query.get("token") || "";
  const forgotStatus = $("#forgotPasswordStatus");
  const resetStatus = $("#passwordResetStatus");

  if (forgotForm) {
    const accountSelect = $("#recoveryAccountType");
    if (["staff", "patient"].includes(accountType)) accountSelect.value = accountType;
    forgotForm.addEventListener("submit", async event => {
      event.preventDefault();
      try {
        await getCsrfToken();
        const result = await adminRequest("/api/auth/password/forgot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: new FormData(forgotForm).get("email"),
            account_type: accountSelect.value
          })
        });
        forgotForm.hidden = true;
        setPageStatus(forgotStatus, result.message);
      } catch (error) {
        setPageStatus(forgotStatus, error.message, true);
      }
    });
  }

  if (resetForm) {
    if (!token || !["staff", "patient"].includes(accountType)) {
      resetForm.hidden = true;
      setPageStatus(resetStatus, "Link yo guhindura ijambobanga ntiyuzuye canke yararengeje igihe.", true);
      return;
    }

    resetForm.addEventListener("submit", async event => {
      event.preventDefault();
      const formData = new FormData(resetForm);
      const password = formData.get("password");
      if (password !== formData.get("password_confirmation")) {
        setPageStatus(resetStatus, "Amabanga wanditse ntahura.", true);
        return;
      }
      try {
        await getCsrfToken();
        const result = await adminRequest("/api/auth/password/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, account_type: accountType, password })
        });
        resetForm.hidden = true;
        setPageStatus(resetStatus, result.message);
        const loginLink = $("#passwordResetLoginLink");
        loginLink.href = accountType === "patient" ? "/patient/" : "/admin/";
        loginLink.hidden = false;
        const staffLinks = $("#passwordResetStaffLinks");
        if (staffLinks) staffLinks.hidden = accountType !== "staff";
      } catch (error) {
        setPageStatus(resetStatus, error.message, true);
      }
    });
  }
}

function setPatientStatus(message, isError = false) {
  const element = $("#patientStatus");
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("status-error", isError);
  element.hidden = !message;
}

function showPatientOrders(orders) {
  const list = $("#patientOrders");
  if (!list) return;
  const pendingCount = orders.filter(order => order.status === "pending").length;
  ["#patientOrderCount", "#patientSideOrderCount", "#patientQuickOrderCount"].forEach(selector => {
    const countElement = $(selector);
    if (countElement) countElement.textContent = String(orders.length);
  });
  const pendingElement = $("#patientPendingCount");
  if (pendingElement) pendingElement.textContent = `${pendingCount} arindiriye`;
  list.innerHTML = orders.length ? orders.map(order => `
    <article class="admin-list-item">
      <div class="admin-item-heading"><b>${formatCurrency(order.total_bif)}</b><span class="status-pill">${escapeHtml(orderStatusLabel(order.status))}</span></div>
      <small>${escapeHtml(new Date(order.created_at).toLocaleString())}</small>
      <p>${order.items.map(item => `${escapeHtml(item.product_name)} × ${item.quantity}`).join(" · ")}</p>
      ${order.status === "pending" ? `<button type="button" class="btn btn-outline" data-cancel-order="${escapeHtml(order.id)}">Hagarika ibwirizwa</button>` : ""}
    </article>
  `).join("") : '<p class="empty-state">Nta mabwirizwa uratanga.</p>';
  list.querySelectorAll("[data-cancel-order]").forEach(button => button.addEventListener("click", async () => {
    try {
      await patientRequest(`/api/patient/orders/${encodeURIComponent(button.dataset.cancelOrder)}/cancel`, { method: "PATCH" });
      await loadPatientOrders();
      await loadPatientProducts();
      setPatientStatus("Ibwirizwa rihagaritswe.");
    } catch (error) {
      setPatientStatus(error.message, true);
    }
  }));
}

async function loadPatientOrders() {
  const orders = await apiRequest("/api/patient/orders");
  showPatientOrders(orders);
}

async function loadPatientProducts() {
  const container = $("#patientProducts");
  if (!container) return;
  const availableProducts = (await fetchProducts()).filter(product => product.is_available);
  ["#patientProductCount", "#patientSideProductCount"].forEach(selector => {
    const countElement = $(selector);
    if (countElement) countElement.textContent = String(availableProducts.length);
  });
  container.innerHTML = availableProducts.length ? availableProducts.map(product => `
    <label class="patient-product">
      <span><b>${escapeHtml(product.name)}</b><small>${escapeHtml(product.category)} · ${product.stock_quantity} mu bubiko · ${product.price == null ? "Igiciro ntikirashirwaho" : formatCurrency(product.price)}</small></span>
      <input type="number" min="0" max="${Math.min(100, product.stock_quantity)}" value="0" data-order-product="${escapeHtml(product.id)}" aria-label="Igitigiri ca ${escapeHtml(product.name)}" ${product.stock_quantity < 1 || product.price == null ? "disabled" : ""}>
    </label>
  `).join("") : '<p class="empty-state">Nta miti iri ku rutonde ubu.</p>';
}

async function patientRequest(path, options = {}) {
  return adminRequest(path, options);
}

function showPatientDashboard(patient) {
  document.body.classList.remove("patient-login-page");
  $("#patientAuth").hidden = true;
  $("#patientDashboard").hidden = false;
  $("#patientIdentity").textContent = patient.full_name;
  const topbarIdentity = $("#patientTopbarIdentity");
  if (topbarIdentity) topbarIdentity.textContent = patient.full_name;
  const email = $("#patientAccountEmail");
  if (email) email.textContent = patient.email || "";
  const phone = $("#patientAccountPhone");
  if (phone) phone.textContent = patient.phone || "";
  const initial = $(".patient-profile-initial");
  if (initial) initial.textContent = patient.full_name?.trim().charAt(0).toLocaleUpperCase() || "U";
  updateProfileAvatar($("#patientProfileAvatar"), patient.profile_image_url, patient.full_name);
  updateProfileAvatar($("#patientTopbarAvatar"), patient.profile_image_url, patient.full_name);
  const nameInput = $("#patientProfileName");
  const phoneInput = $("#patientProfilePhone");
  if (nameInput) nameInput.value = patient.full_name || "";
  if (phoneInput) phoneInput.value = patient.phone || "";
}

function showPatientAuth() {
  document.body.classList.add("patient-login-page");
  $("#patientDashboard").hidden = true;
  $("#patientAuth").hidden = false;
}

function careRequestStatusLabel(status) {
  return ({ open: "Irindiriye", in_progress: "Turiko turabikurikirana", closed: "Yarangiye" })[status] || status;
}

function doctorRequestStatusLabel(status) {
  return ({ not_requested: "Nta muganga yasabwe", requested: "Umuganga yasabwe", assigned: "Muganga yagenywe", contacted: "Umurwayi yaravugishijwe", scheduled: "Igihe carateguwe", completed: "Gukurikirana vyarangiye" })[status] || status;
}

function renderCareMessages(container, messages, currentSender = "patient") {
  container.innerHTML = messages.length ? messages.map(message => `<article class="care-message ${message.sender === currentSender ? "care-message-own" : ""}"><div><b>${escapeHtml(message.sender_name || (message.sender === "staff" ? "Umukozi wa farumasi" : "Jewe"))}</b><time>${escapeHtml(new Date(message.created_at).toLocaleString())}</time></div><p>${escapeHtml(message.message)}</p></article>`).join("") : '<p class="care-message-empty">Nta butumwa burungitswe. Ushobora kwandikira abakozi hano.</p>';
}

async function downloadPrivateCareFile(path, requestId) {
  const response = await fetch(apiUrl(path), { credentials: "include", cache: "no-store" });
  if (!response.ok) {
    let message = "Ntivyashobotse gukuraho urupapuro rw'umuti.";
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  const blob = await response.blob();
  const extension = ({ "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[response.headers.get("Content-Type")?.split(";")[0]] || "bin";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `urupapuro-${String(requestId).slice(0, 8)}.${extension}`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function openPrivateCarePreview(path) {
  const response = await fetch(apiUrl(path), { credentials: "include", cache: "no-store" });
  if (!response.ok) {
    let message = "Ntivyashobotse kwugurura urupapuro rw'umuti.";
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  const mimeType = response.headers.get("Content-Type")?.split(";")[0].toLowerCase();
  if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    throw new Error("Ubwoko bw'iyi dosiye ntibushobora kwerekanwa hano.");
  }
  const previewUrl = URL.createObjectURL(await response.blob());
  let dialog = $("#privateCarePreviewDialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "privateCarePreviewDialog";
    dialog.className = "private-care-preview-dialog";
    dialog.setAttribute("aria-labelledby", "privateCarePreviewTitle");
    dialog.innerHTML = `<header><div><span class="section-kicker">AMAKURU Y'UMURWAYI</span><h2 id="privateCarePreviewTitle">Urupapuro rw'umuti</h2><p>Reba iyi nyandiko mu buryo bw'ibanga.</p></div><button type="button" data-close-care-preview aria-label="Funga">×</button></header><div class="private-care-preview-content"></div>`;
    dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener("close", () => {
      dialog.querySelector(".private-care-preview-content").replaceChildren();
      if (dialog.dataset.objectUrl) URL.revokeObjectURL(dialog.dataset.objectUrl);
      delete dialog.dataset.objectUrl;
    });
    dialog.querySelector("[data-close-care-preview]").addEventListener("click", () => dialog.close());
    document.body.append(dialog);
  }
  if (dialog.open) dialog.close();
  const content = dialog.querySelector(".private-care-preview-content");
  if (dialog.dataset.objectUrl) URL.revokeObjectURL(dialog.dataset.objectUrl);
  dialog.dataset.objectUrl = previewUrl;
  if (mimeType === "application/pdf") {
    const frame = document.createElement("iframe");
    frame.title = "Urupapuro rw'umuti";
    frame.src = `${previewUrl}#toolbar=0&navpanes=0&view=FitH`;
    content.replaceChildren(frame);
  } else {
    const image = document.createElement("img");
    image.src = previewUrl;
    image.alt = "Urupapuro rw'umuti rw'umurwayi";
    content.replaceChildren(image);
  }
  dialog.showModal();
}

function renderPatientCareRequests(requests) {
  const list = $("#patientCareRequests");
  if (!list) return;
  ["#patientCareRequestCount", "#patientQuickCareCount"].forEach(selector => {
    const count = $(selector);
    if (count) count.textContent = String(requests.length);
  });
  list.innerHTML = requests.length ? requests.map(request => `
    <article class="patient-care-request-card" data-care-request-card="${escapeHtml(request.id)}">
      <header><div><b>${escapeHtml(request.treatment_location)}</b><small>${escapeHtml(new Date(`${request.treated_on}T00:00:00`).toLocaleDateString())} · ${escapeHtml(new Date(request.created_at).toLocaleDateString())}</small></div><span class="care-status-pill care-status-${escapeHtml(request.status)}">${escapeHtml(careRequestStatusLabel(request.status))}</span></header>
      <p class="care-doctor-status">${escapeHtml(doctorRequestStatusLabel(request.doctor_consultation_status))}</p>
      ${request.doctor_name ? `<section class="patient-doctor-appointment"><div class="patient-doctor-heading"><span>✚</span><div><small>UMUGANGA AKURONDERA</small><b>${escapeHtml(request.doctor_name)}</b></div></div>${request.doctor_scheduled_at ? `<div class="patient-doctor-booking"><div><small>IGIHE CYO KUBONANA</small><b>${escapeHtml(new Date(request.doctor_scheduled_at).toLocaleString())}</b></div><a href="${escapeHtml(request.doctor_meeting_url)}" target="_blank" rel="noopener noreferrer">Injira mu kiganiro ca videwo ↗</a></div>` : `<p>Umuganga yagenywe; igihe co kubonana kizohererezwa hano ni kimara gutegurwa.</p>`}<a class="patient-message-link" href="messages.html?care_request_id=${encodeURIComponent(request.id)}&conversation=doctor">Ubutumwa bw'ibanga n'umuganga <span aria-hidden="true">→</span></a></section>` : request.doctor_consultation_status === "requested" ? `<p class="patient-doctor-pending">Twarakiriye igisabwa co kuvugana n'umuganga; abakozi bariko baragishira ku murongo.</p>` : ""}
      <div class="care-request-actions">${request.has_prescription ? `<button type="button" class="btn btn-outline" data-patient-care-prescription="${escapeHtml(request.id)}">Kuraho urupapuro rw'umuti</button>` : `<small>Nta rupapuro rw'umuti rwashizweko.</small>`}</div>
      <a class="patient-message-link" href="messages.html?care_request_id=${encodeURIComponent(request.id)}&conversation=staff">Ubutumwa bw'abafarumasiye n'abandi bakozi <span aria-hidden="true">→</span></a>
    </article>`).join("") : '<p class="empty-state">Nta busabe urungitse. Uzuza ifishi iri hejuru kugira dutangure kugufasha.</p>';
}

async function loadPatientCareRequests() {
  const list = $("#patientCareRequests");
  if (!list) return;
  list.innerHTML = '<p class="empty-state">Turiko turarondera ibisabwa vyawe...</p>';
  try {
    const requests = await apiRequest("/api/patient/care-requests");
    renderPatientCareRequests(requests);
  } catch (error) {
    list.innerHTML = `<p class="status-error">${escapeHtml(error.message)}</p>`;
  }
}

async function loadPatientCareMessages(requestId, container) {
  container.innerHTML = '<p class="care-message-empty">Turiko turarondera ubutumwa...</p>';
  try {
    renderCareMessages(container, await apiRequest(`/api/patient/care-requests/${encodeURIComponent(requestId)}/messages`));
  } catch (error) {
    container.innerHTML = `<p class="status-error">${escapeHtml(error.message)}</p>`;
  }
}

async function loadPatientDoctorMessages(requestId, container) {
  container.innerHTML = '<p class="care-message-empty">Turiko turarondera ubutumwa...</p>';
  try { renderCareMessages(container, await apiRequest(`/api/patient/care-requests/${encodeURIComponent(requestId)}/doctor-messages`), "patient"); }
  catch (error) { container.innerHTML = `<p class="status-error">${escapeHtml(error.message)}</p>`; }
}

function renderStaffCareRequests(requests, container, doctors = []) {
  if (!container) return;
  container.innerHTML = requests.length ? requests.map(request => `
    <article class="staff-care-request-card" data-staff-care-card="${escapeHtml(request.id)}">
      <header><div><b>${escapeHtml(request.patient_name)}</b><small>${escapeHtml(request.treatment_location)} · Yakirijwe ${escapeHtml(new Date(`${request.treated_on}T00:00:00`).toLocaleDateString())}</small></div><span class="care-status-pill care-status-${escapeHtml(request.status)}">${escapeHtml(careRequestStatusLabel(request.status))}</span></header>
      <div class="staff-care-meta"><label>Uko igisabwa gihagaze<select data-staff-care-status="${escapeHtml(request.id)}"><option value="open" ${request.status === "open" ? "selected" : ""}>Irindiriye</option><option value="in_progress" ${request.status === "in_progress" ? "selected" : ""}>Turiko turabikurikirana</option><option value="closed" ${request.status === "closed" ? "selected" : ""}>Yarangiye</option></select></label><div class="staff-doctor-status"><b>Gukurikirana kwa muganga</b><span>${escapeHtml(doctorRequestStatusLabel(request.doctor_consultation_status))}${request.assigned_doctor_name ? ` · ${escapeHtml(request.assigned_doctor_name)}` : ""}</span></div></div>
      ${currentStaff?.role === "admin" && ["requested", "assigned", "contacted", "scheduled"].includes(request.doctor_consultation_status) ? `<form class="staff-doctor-assignment" data-assign-doctor="${escapeHtml(request.id)}"><label for="doctorFor-${escapeHtml(request.id)}">Umuganga azokurikirana iki gisabwa</label><div><select id="doctorFor-${escapeHtml(request.id)}" name="doctor_id" required><option value="">${doctors.length ? "Hitamwo umuganga" : "Nta muganga akora kuri ubu"}</option>${doctors.map(doctor => `<option value="${escapeHtml(doctor.id)}" ${doctor.id === request.assigned_doctor_id ? "selected" : ""}>${escapeHtml(doctor.username)}</option>`).join("")}</select><button class="btn btn-outline" type="submit" ${doctors.length ? "" : "disabled"}>${request.assigned_doctor_id ? "Hindura umuganga" : "Shinga umuganga"}</button></div></form>` : ""}
      <div class="care-request-actions">${request.has_prescription ? `<button type="button" class="btn btn-outline" data-staff-care-prescription="${escapeHtml(request.id)}">Kuraho urupapuro rw'umuti</button>` : `<small>Nta rupapuro rw'umuti rwashizweko.</small>`}<small>Vugana n'umurwayi biciye kuri ubu butumwa.</small></div>
      <details class="care-conversation"><summary data-staff-care-messages="${escapeHtml(request.id)}">Ubutumwa n'umurwayi</summary><div class="care-message-list" data-staff-care-thread="${escapeHtml(request.id)}"><p class="care-message-empty">Fyonda kugira urabe ubutumwa.</p></div><form class="care-message-form" data-staff-care-reply="${escapeHtml(request.id)}" ${request.status === "closed" ? "hidden" : ""}><textarea name="message" rows="2" maxlength="4000" required placeholder="Andika inyishu y'umukozi..."></textarea><button class="btn btn-primary" type="submit">Rungika inyishu</button></form></details>
    </article>`).join("") : '<p class="empty-state">Nta busabe bwo gufashwa burashika.</p>';
}

async function loadStaffCareRequests() {
  const container = $("#pharmacistCareRequests") || $("#adminCareRequests");
  if (!container) return;
  container.innerHTML = '<p class="empty-state">Turiko turarondera ibisabwa...</p>';
  try {
    const [requests, staff] = await Promise.all([
      adminRequest("/api/staff/care-requests"),
      currentStaff?.role === "admin" ? adminRequest("/api/admin/staff") : Promise.resolve([])
    ]);
    renderStaffCareRequests(requests, container, staff.filter(account => account.role === "doctor" && account.is_active));
    const count = $("#pharmacistCareRequestCount");
    if (count) count.textContent = String(requests.filter(request => request.status !== "closed").length);
  } catch (error) {
    container.innerHTML = `<p class="status-error">${escapeHtml(error.message)}</p>`;
  }
}

async function loadStaffCareMessages(requestId, container) {
  container.innerHTML = '<p class="care-message-empty">Turiko turarondera ubutumwa...</p>';
  try {
    renderCareMessages(container, await adminRequest(`/api/staff/care-requests/${encodeURIComponent(requestId)}/messages`), "staff");
  } catch (error) {
    container.innerHTML = `<p class="status-error">${escapeHtml(error.message)}</p>`;
  }
}

function setupCareRequestActions() {
  const patientList = $("#patientCareRequests");
  if (patientList) {
    $("#refreshPatientCareRequests").addEventListener("click", loadPatientCareRequests);
    $("#patientCareRequestForm").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const file = $("#carePrescription").files[0];
      if (file && (!/[.]pdf$/i.test(file.name) && !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024)) {
        setPatientStatus("Hitamwo PDF, JPEG, PNG canke WebP itarenza 5 MB.", true);
        return;
      }
      const data = new FormData(form);
      data.set("request_doctor", String($("#careRequestDoctor").checked));
      try {
        const button = $("#submitPatientCareRequest");
        button.disabled = true;
        await patientRequest("/api/patient/care-requests", { method: "POST", body: data });
        form.reset();
        setPatientStatus("Igisabwa cawe carungitswe ku bakozi ba farumasi.");
        await loadPatientCareRequests();
      } catch (error) {
        setPatientStatus(error.message, true);
      } finally {
        $("#submitPatientCareRequest").disabled = false;
      }
    });
    patientList.addEventListener("click", async event => {
      const summary = event.target.closest("[data-patient-care-messages]");
      const doctorSummary = event.target.closest("[data-patient-doctor-messages]");
      const download = event.target.closest("[data-patient-care-prescription]");
      if (summary) {
        const thread = patientList.querySelector(`[data-patient-care-thread="${CSS.escape(summary.dataset.patientCareMessages)}"]`);
        if (thread && !summary.parentElement.open) {
          await loadPatientCareMessages(summary.dataset.patientCareMessages, thread);
        }
      }
      if (doctorSummary && !doctorSummary.parentElement.open) {
        const thread = patientList.querySelector(`[data-patient-doctor-thread="${CSS.escape(doctorSummary.dataset.patientDoctorMessages)}"]`);
        if (thread) await loadPatientDoctorMessages(doctorSummary.dataset.patientDoctorMessages, thread);
      }
      if (download) {
        try { await downloadPrivateCareFile(`/api/patient/care-requests/${encodeURIComponent(download.dataset.patientCarePrescription)}/prescription`, download.dataset.patientCarePrescription); }
        catch (error) { setPatientStatus(error.message, true); }
      }
    });
    patientList.addEventListener("submit", async event => {
      const doctorReply = event.target.closest("[data-patient-doctor-reply]");
      if (doctorReply) {
        event.preventDefault();
        const requestId = doctorReply.dataset.patientDoctorReply;
        const thread = patientList.querySelector(`[data-patient-doctor-thread="${CSS.escape(requestId)}"]`);
        try {
          await patientRequest(`/api/patient/care-requests/${encodeURIComponent(requestId)}/doctor-messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: new FormData(doctorReply).get("message") }) });
          doctorReply.reset();
          if (thread) await loadPatientDoctorMessages(requestId, thread);
          setPatientStatus("Ubutumwa burungitswe ku muganga.");
        } catch (error) { setPatientStatus(error.message, true); }
        return;
      }
      const form = event.target.closest("[data-patient-care-reply]");
      if (!form) return;
      event.preventDefault();
      const requestId = form.dataset.patientCareReply;
      const thread = patientList.querySelector(`[data-patient-care-thread="${CSS.escape(requestId)}"]`);
      try {
        await patientRequest(`/api/patient/care-requests/${encodeURIComponent(requestId)}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: new FormData(form).get("message") }) });
        form.reset();
        if (thread) await loadPatientCareMessages(requestId, thread);
        setPatientStatus("Ubutumwa bwawe burungitswe ku bakozi.");
      } catch (error) { setPatientStatus(error.message, true); }
    });
  }

  document.querySelectorAll("[data-refresh-staff-care]").forEach(button => button.addEventListener("click", loadStaffCareRequests));
  [$("#pharmacistCareRequests"), $("#adminCareRequests")].filter(Boolean).forEach(container => {
    container.addEventListener("click", async event => {
      const summary = event.target.closest("[data-staff-care-messages]");
      const download = event.target.closest("[data-staff-care-prescription]");
      if (summary) {
        const thread = container.querySelector(`[data-staff-care-thread="${CSS.escape(summary.dataset.staffCareMessages)}"]`);
        if (thread && !summary.parentElement.open) await loadStaffCareMessages(summary.dataset.staffCareMessages, thread);
      }
      if (download) {
        try { await downloadPrivateCareFile(`/api/staff/care-requests/${encodeURIComponent(download.dataset.staffCarePrescription)}/prescription`, download.dataset.staffCarePrescription); }
        catch (error) { setStatus(error.message, true); }
      }
    });
    container.addEventListener("submit", async event => {
      const assignment = event.target.closest("[data-assign-doctor]");
      if (assignment) {
        event.preventDefault();
        try {
          await adminRequest(`/api/admin/care-requests/${encodeURIComponent(assignment.dataset.assignDoctor)}/assign-doctor`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doctor_id: new FormData(assignment).get("doctor_id") }) });
          await loadStaffCareRequests();
          setStatus("Umuganga yagenywe kugira akurikirane umurwayi.");
        } catch (error) { setStatus(error.message, true); }
        return;
      }
      const form = event.target.closest("[data-staff-care-reply]");
      if (!form) return;
      event.preventDefault();
      const requestId = form.dataset.staffCareReply;
      const thread = container.querySelector(`[data-staff-care-thread="${CSS.escape(requestId)}"]`);
      try {
        await adminRequest(`/api/staff/care-requests/${encodeURIComponent(requestId)}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: new FormData(form).get("message") }) });
        form.reset();
        if (thread) await loadStaffCareMessages(requestId, thread);
        await loadStaffCareRequests();
        setStatus("Inyishu yarungitswe ku murwayi.");
      } catch (error) { setStatus(error.message, true); }
    });
    container.addEventListener("change", async event => {
      const statusField = event.target.closest("[data-staff-care-status], [data-staff-doctor-status]");
      if (!statusField) return;
      const isDoctor = statusField.matches("[data-staff-doctor-status]");
      const requestId = isDoctor ? statusField.dataset.staffDoctorStatus : statusField.dataset.staffCareStatus;
      try {
        await adminRequest(`/api/staff/care-requests/${encodeURIComponent(requestId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isDoctor ? { doctor_consultation_status: statusField.value } : { status: statusField.value }) });
        await loadStaffCareRequests();
        setStatus("Ivyerekeye ubusabe vyahinduwe.");
      } catch (error) { setStatus(error.message, true); }
    });
  });
}

async function loadPatientSession() {
  await getCsrfToken();
  const session = await apiRequest("/api/patient/session");
  showPatientDashboard(session.patient);
  await Promise.all([loadPatientProducts(), loadPatientOrders(), loadPatientCareRequests()]);
}

function setupPatientDashboard() {
  const auth = $("#patientAuth");
  if (!auth) return;
  const panelTabs = [...document.querySelectorAll("[data-patient-panel]")];
  const panelNames = ["shop", "orders", "careRequests", "account"];
  const selectPatientPanel = name => {
    panelNames.forEach(panelName => {
      const panel = $(`#patientPanel${panelName[0].toUpperCase()}${panelName.slice(1)}`);
      if (panel) panel.hidden = panelName !== name;
    });
    document.querySelectorAll(".admin-side-link[data-patient-panel]").forEach(link => {
      link.classList.toggle("active", link.dataset.patientPanel === name);
    });
    document.body.classList.remove("admin-menu-open");
    const menuToggle = $("#patientMenuToggle");
    if (menuToggle) menuToggle.setAttribute("aria-expanded", "false");
  };
  panelTabs.forEach(tab => tab.addEventListener("click", () => selectPatientPanel(tab.dataset.patientPanel)));
  const profileForm = $("#patientProfileForm");
  const profileImage = $("#patientProfileImage");
  const removeProfileImage = $("#patientRemoveProfileImage");
  profileImage.addEventListener("change", () => { if (profileImage.files.length) removeProfileImage.checked = false; });
  removeProfileImage.addEventListener("change", () => { if (removeProfileImage.checked) profileImage.value = ""; });
  profileForm.addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("#savePatientProfile");
    const status = $("#patientProfileStatus");
    const data = new FormData(profileForm);
    data.set("remove_profile_image", String(removeProfileImage.checked));
    button.disabled = true;
    status.textContent = "Turiko turabika amakuru yawe...";
    status.classList.remove("is-error");
    try {
      const result = await patientRequest("/api/patient/profile", { method: "PATCH", body: data });
      showPatientDashboard(result.patient);
      profileImage.value = "";
      removeProfileImage.checked = false;
      status.textContent = "Amakuru ya konti yabitswe neza.";
    } catch (error) {
      status.textContent = error.message;
      status.classList.add("is-error");
    } finally { button.disabled = false; }
  });
  const menuToggle = $("#patientMenuToggle");
  if (menuToggle) {
    menuToggle.addEventListener("click", () => {
      const open = document.body.classList.toggle("admin-menu-open");
      menuToggle.setAttribute("aria-expanded", String(open));
    });
  }
  const loginForm = $("#patientLoginForm");
  const registerForm = $("#patientRegisterForm");
  const showLogin = () => {
    loginForm.hidden = false;
    registerForm.hidden = true;
    $("#showPatientLogin").classList.add("active");
    $("#showPatientRegister").classList.remove("active");
  };
  const showRegister = () => {
    loginForm.hidden = true;
    registerForm.hidden = false;
    $("#showPatientLogin").classList.remove("active");
    $("#showPatientRegister").classList.add("active");
  };
  $("#showPatientLogin").addEventListener("click", showLogin);
  $("#showPatientRegister").addEventListener("click", showRegister);
  const submitAuth = async (form, endpoint) => {
    const credentials = Object.fromEntries(new FormData(form).entries());
    try {
      await getCsrfToken();
      const result = await patientRequest(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials)
      });
      csrfToken = result.csrfToken;
      form.reset();
      showPatientDashboard(result.patient);
      await Promise.all([loadPatientProducts(), loadPatientOrders(), loadPatientCareRequests()]);
      setPatientStatus("Winjiye neza.");
    } catch (error) {
      setPatientStatus(error.message, true);
    }
  };
  loginForm.addEventListener("submit", event => {
    event.preventDefault();
    submitAuth(loginForm, "/api/patient/login");
  });
  registerForm.addEventListener("submit", event => {
    event.preventDefault();
    submitAuth(registerForm, "/api/patient/register");
  });
  $("#patientLogout").addEventListener("click", async () => {
    try {
      await patientRequest("/api/patient/logout", { method: "POST" });
      csrfToken = "";
      showPatientAuth();
      setPatientStatus("Wasohotse neza.");
    } catch (error) {
      setPatientStatus(error.message, true);
    }
  });
  $("#patientOrderForm").addEventListener("submit", async event => {
    event.preventDefault();
    const items = [...$("#patientProducts").querySelectorAll("[data-order-product]")]
      .map(input => ({ product_id: input.dataset.orderProduct, quantity: Number(input.value) }))
      .filter(item => item.quantity > 0);
    if (!items.length) {
      setPatientStatus("Hitamwo umuti n'igitigiri ushaka.", true);
      return;
    }
    try {
      const order = await patientRequest("/api/patient/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items })
      });
      await Promise.all([loadPatientProducts(), loadPatientOrders()]);
      setPatientStatus(`Ibwirizwa ${order.id.slice(0, 8)} ryarungitswe, ririndiriye kwemezwa.`);
    } catch (error) {
      setPatientStatus(error.message, true);
    }
  });
  loadPatientSession().catch(error => {
    if (error.message !== "Patient sign-in required.") {
      console.error("Could not load the patient dashboard.", error);
      setPatientStatus(error.message, true);
    }
    showPatientAuth();
  });
  const treatedOn = $("#careTreatedOn");
  if (treatedOn) {
    const today = new Date();
    treatedOn.max = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  }
}

function resetProductForm() {
  const form = $("#productForm");
  if (!form) return;
  form.reset();
  $("#productId").value = "";
  $("#productStock").value = "0";
  $("#productExtraFields").open = false;
  $("#imagePreview").removeAttribute("src");
  $("#imagePreview").hidden = true;
  $("#productImageUrl").value = "";
  $("#imageHelp").textContent = "JPEG, PNG canke WebP; ntirenge 5 MB. Ifoto ibikwa kuri server.";
  $("#productAvailability").checked = true;
  $("#saveProduct").textContent = "Bika umuti";
}

function setupWhatsApp() {
  const message = "Bwakeye UBUZIMA PHARMA. Ndashaka kubaza ibijanye n'imiti mufise.";
  const url = whatsappUrl(message);
  ["#contactWhatsApp", "#contactWhatsAppSecondary", "#contactProductWhatsApp", "#footerWhatsApp", "#floatingWhatsApp"].forEach(selector => {
    const element = $(selector);
    if (!element) return;
    element.href = url || "#";
    element.addEventListener("click", event => {
      if (!url) {
        event.preventDefault();
        alert("Shira inomero ya WhatsApp ya UBUZIMA PHARMA muri dosiye config.js kugira iyi buto ikore.");
      }
    });
  });
  const phoneDisplay = $("#phoneDisplay");
  if (phoneDisplay && whatsapp && !whatsapp.includes("XXXXXXXX")) phoneDisplay.textContent = `+${whatsapp}`;
}

document.addEventListener("DOMContentLoaded", () => {
  cart = loadCart();
  const year = $("#year");
  if (year) year.textContent = new Date().getFullYear();
  setupCatalogue();
  setupProductDetailPage();
  setupProductManager();
  setupStaffAccess();
  setupStaffProfile();
  setupAdminDashboard();
  setupPharmacistDashboard();
  setupStaffNews();
  setupStaffVideos();
  setupContentSettings();
  setupNewsAndEmailPages();
  setupPasswordRecoveryPages();
  setupCareRequestActions();
  setupPatientDashboard();
  setupPatientMessagesPage();
  setupDoctorDashboard();
  setupDoctorMessagesPage();
  setupWhatsApp();
  const toggle = $("#menuToggle");
  const nav = $("#mainNav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "×" : "☰";
    });
    nav.querySelectorAll("a").forEach(link => link.addEventListener("click", () => {
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "☰";
    }));
  }
});
