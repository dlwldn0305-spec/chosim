/* =========================
   CHOSHIM collection.js
========================= */

const KEY_BOOK = "choshim_book_v1";

function getBook(){
  try {
    return JSON.parse(localStorage.getItem(KEY_BOOK) || "[]");
  } catch {
    return [];
  }
}

const grid = document.getElementById("bookGrid");
const empty = document.getElementById("bookEmpty");

function renderBook(){
  const book = getBook();

  // ✅ 비었으면: 보이기 + 그리드 비우기
  if (!book.length){
    empty.setAttribute("aria-hidden", "false");
    empty.style.display = "block";
    grid.innerHTML = "";
    return;
  }

  // ✅ 하나라도 있으면: "아직 없습니다" 완전 숨기기
  empty.setAttribute("aria-hidden", "true");
  empty.style.display = "none";

  grid.innerHTML = "";

  book.forEach(entry => {
    const card = document.createElement("article");
    card.className = "book-card";

    const img = document.createElement("img");
    img.className = "book-img";
    img.src = entry.snapshot;
    img.alt = "초심 돌";

    const meta = document.createElement("div");
    meta.className = "book-meta";

    const d = document.createElement("div");
    d.className = "book-d";
    d.textContent = `D+${entry.d}`;

    const text = document.createElement("div");
    text.className = "book-text";
    text.textContent = entry.text;

    meta.appendChild(d);
    meta.appendChild(text);

    card.appendChild(img);
    card.appendChild(meta);

    grid.appendChild(card);
  });
}

document.addEventListener("DOMContentLoaded", renderBook);
