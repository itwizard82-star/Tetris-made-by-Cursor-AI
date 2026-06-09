// ============================================================
// 테트리스 — 핵심 데이터, 충돌 판정, 조작, 줄 삭제, 게임 오버
// ============================================================

// --- 보드 크기 상수 ---
const COLS = 10;
const ROWS = 20;

// --- 낙하 속도 (레벨에 따라 변함) ---
const BASE_DROP_INTERVAL = 500; // 레벨 1 기본 간격 (ms)
const MIN_DROP_INTERVAL = 80;   // 최대 속도 하한
const LEVEL_SCORE_STEP = 500;   // 이 점수마다 레벨 1 상승

// --- 줄 삭제 점수 ---
const LINE_SCORES = { 1: 100, 2: 300, 3: 500, 4: 800 };

// --- 블록 종류 목록 ---
const PIECE_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

// --- 캔버스 및 DOM 요소 ---
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const linesEl = document.getElementById('lines');
const gameOverEl = document.getElementById('game-over');
const restartBtn = document.getElementById('restart-btn');

const BLOCK_SIZE = canvas.width / COLS;
const NEXT_CELL_SIZE = nextCanvas.width / 4; // 4×4 격자에 맞춰 미리보기

// ============================================================
// 7가지 테트로미노 정의
// ============================================================
const TETROMINOS = {
  I: {
    color: '#00f0f0',
    shape: [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  },
  O: {
    color: '#f0f000',
    shape: [[1, 1], [1, 1]],
  },
  T: {
    color: '#a000f0',
    shape: [
      [0, 1, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
  },
  S: {
    color: '#00f000',
    shape: [
      [0, 1, 1],
      [1, 1, 0],
      [0, 0, 0],
    ],
  },
  Z: {
    color: '#f00000',
    shape: [
      [1, 1, 0],
      [0, 1, 1],
      [0, 0, 0],
    ],
  },
  J: {
    color: '#0000f0',
    shape: [
      [1, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
  },
  L: {
    color: '#f0a000',
    shape: [
      [0, 0, 1],
      [1, 1, 1],
      [0, 0, 0],
    ],
  },
};

// ============================================================
// 게임 상태
// ============================================================
let board;
let currentPiece;
let nextPieceType;
let score;
let totalLines;
let gameOver;
let dropTimer;

/** 빈 10×20 보드 그리드를 생성한다 */
function createEmptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

/** 랜덤 테트로미노 타입을 반환한다 */
function randomPieceType() {
  return PIECE_TYPES[Math.floor(Math.random() * PIECE_TYPES.length)];
}

/** 점수 기반 현재 레벨 (500점마다 1레벨 상승, 최소 1) */
function getLevel() {
  return Math.floor(score / LEVEL_SCORE_STEP) + 1;
}

/** 레벨에 따른 자동 낙하 간격 — 레벨이 오를수록 짧아진다 */
function getDropInterval() {
  const level = getLevel();
  return Math.max(MIN_DROP_INTERVAL, BASE_DROP_INTERVAL - (level - 1) * 40);
}

function getSpawnCol(shape) {
  return Math.floor((COLS - shape[0].length) / 2);
}

/** 지정 타입의 테트로미노 객체 생성 (shape는 복사본) */
function createPiece(type) {
  const { shape, color } = TETROMINOS[type];
  return {
    type,
    shape: shape.map((row) => [...row]),
    color,
    row: 0,
    col: getSpawnCol(shape),
  };
}

// ============================================================
// 충돌 판정
// ============================================================

/**
 * shape의 채워진(1) 칸 좌표 목록을 반환한다
 * @returns {{ row: number, col: number }[]}
 */
function getOccupiedCells(row, col, shape) {
  const cells = [];
  for (let dy = 0; dy < shape.length; dy++) {
    for (let dx = 0; dx < shape[dy].length; dx++) {
      if (shape[dy][dx]) {
        cells.push({ row: row + dy, col: col + dx });
      }
    }
  }
  return cells;
}

/**
 * 주어진 위치·모양의 블록이 보드 안에 놓일 수 있는지 판정한다
 * - 모든 채워진 칸이 좌우·아래 경계 안에 있어야 한다
 * - row < 0 (보드 위 스폰 영역)은 허용하되, col은 항상 0~COLS-1
 * - 고정 블록과 겹치면 false
 */
function isValidPosition(piece, row, col, shape = piece.shape) {
  const cells = getOccupiedCells(row, col, shape);

  for (const { row: cellRow, col: cellCol } of cells) {
    // 좌우·아래 경계 밖이면 불가
    if (cellCol < 0 || cellCol >= COLS || cellRow >= ROWS) {
      return false;
    }

    // 보드 안쪽에서 고정 블록과 겹치면 불가
    if (cellRow >= 0 && board[cellRow][cellCol]) {
      return false;
    }
  }

  return true;
}

// ============================================================
// 블록 이동·회전·고정
// ============================================================

/** shape 배열을 시계방향 90° 회전한 새 배열을 반환한다 */
function rotateShape(shape) {
  const rows = shape.length;
  const cols = shape[0].length;
  const rotated = Array.from({ length: cols }, () => Array(rows).fill(0));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      rotated[c][rows - 1 - r] = shape[r][c];
    }
  }
  return rotated;
}

/**
 * 시계방향 회전 — 회전 후 좌표가 경계·블록과 충돌하면
 * shape를 변경하지 않아 회전이 취소된다
 */
function rotatePiece() {
  const prevShape = currentPiece.shape;
  const newShape = rotateShape(prevShape);

  if (isValidPosition(currentPiece, currentPiece.row, currentPiece.col, newShape)) {
    currentPiece.shape = newShape;
    return true;
  }

  // 회전 취소: prevShape를 그대로 유지 (명시적으로 복원)
  currentPiece.shape = prevShape;
  return false;
}

/** 현재 블록을 보드 그리드에 고정 (경계 밖 칸은 무시) */
function lockPiece(piece) {
  getOccupiedCells(piece.row, piece.col, piece.shape).forEach(({ row, col }) => {
    if (row >= 0 && row < ROWS && col >= 0 && col < COLS) {
      board[row][col] = piece.type;
    }
  });
}

function moveDown() {
  if (isValidPosition(currentPiece, currentPiece.row + 1, currentPiece.col)) {
    currentPiece.row++;
    return true;
  }
  return false;
}

function moveHorizontal(colOffset) {
  const newCol = currentPiece.col + colOffset;
  if (isValidPosition(currentPiece, currentPiece.row, newCol)) {
    currentPiece.col = newCol;
    return true;
  }
  return false;
}

function hardDrop() {
  while (isValidPosition(currentPiece, currentPiece.row + 1, currentPiece.col)) {
    currentPiece.row++;
  }
}

// ============================================================
// 줄 삭제 및 점수·레벨
// ============================================================

function clearLines() {
  let cleared = 0;

  for (let row = ROWS - 1; row >= 0; row--) {
    if (board[row].every((cell) => cell !== 0)) {
      board.splice(row, 1);
      board.unshift(Array(COLS).fill(0));
      cleared++;
      row++;
    }
  }

  return cleared;
}

function addScore(linesCleared) {
  if (linesCleared <= 0) return;

  const prevLevel = getLevel();
  score += LINE_SCORES[linesCleared] || 0;
  totalLines += linesCleared;
  updateScoreDisplay();

  // 레벨 상승 시 낙하 속도 갱신
  if (getLevel() !== prevLevel && !gameOver) {
    startDropTimer();
  }
}

function updateScoreDisplay() {
  scoreEl.textContent = score;
  linesEl.textContent = totalLines;
  levelEl.textContent = getLevel();
}

// ============================================================
// 블록 고정 → 줄 삭제 → 새 블록 스폰
// ============================================================

function lockAndSpawn() {
  lockPiece(currentPiece);

  const linesCleared = clearLines();
  addScore(linesCleared);

  spawnPiece();
  draw();
}

/** next 큐에서 블록을 꺼내 현재 블록으로, 새 next를 준비한다 */
function spawnPiece() {
  currentPiece = createPiece(nextPieceType);
  nextPieceType = randomPieceType();
  drawNextPreview();

  if (!isValidPosition(currentPiece, currentPiece.row, currentPiece.col)) {
    endGame();
  }
}

// ============================================================
// 자동 낙하
// ============================================================

function tick() {
  if (gameOver) return;

  if (moveDown()) {
    draw();
  } else {
    lockAndSpawn();
  }
}

function startDropTimer() {
  stopDropTimer();
  dropTimer = setInterval(tick, getDropInterval());
}

function stopDropTimer() {
  if (dropTimer !== null) {
    clearInterval(dropTimer);
    dropTimer = null;
  }
}

// ============================================================
// 게임 오버 및 재시작
// ============================================================

function endGame() {
  gameOver = true;
  stopDropTimer();
  gameOverEl.classList.remove('hidden');
  draw();
}

function resetGame() {
  board = createEmptyBoard();
  score = 0;
  totalLines = 0;
  gameOver = false;

  nextPieceType = randomPieceType();
  currentPiece = createPiece(nextPieceType);
  nextPieceType = randomPieceType();

  updateScoreDisplay();
  gameOverEl.classList.add('hidden');

  drawNextPreview();
  draw();
  startDropTimer();
}

// ============================================================
// 키보드 조작
// ============================================================

document.addEventListener('keydown', (e) => {
  if (gameOver) return;

  let handled = true;

  switch (e.code) {
    case 'ArrowLeft':
      if (moveHorizontal(-1)) draw();
      break;
    case 'ArrowRight':
      if (moveHorizontal(1)) draw();
      break;
    case 'ArrowDown':
      if (moveDown()) {
        draw();
      } else {
        lockAndSpawn();
      }
      break;
    case 'ArrowUp':
      if (rotatePiece()) draw();
      break;
    case 'Space':
      hardDrop();
      lockAndSpawn();
      break;
    default:
      handled = false;
  }

  if (handled) {
    e.preventDefault();
  }
});

restartBtn.addEventListener('click', resetGame);

// ============================================================
// 그리기 — 메인 보드
// ============================================================

function drawCell(context, col, row, color, cellSize) {
  const px = col * cellSize;
  const py = row * cellSize;

  context.fillStyle = color;
  context.fillRect(px, py, cellSize, cellSize);

  context.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  context.lineWidth = 1;
  context.strokeRect(px + 0.5, py + 0.5, cellSize - 1, cellSize - 1);
}

function drawGrid() {
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1;

  for (let col = 0; col <= COLS; col++) {
    ctx.beginPath();
    ctx.moveTo(col * BLOCK_SIZE, 0);
    ctx.lineTo(col * BLOCK_SIZE, canvas.height);
    ctx.stroke();
  }

  for (let row = 0; row <= ROWS; row++) {
    ctx.beginPath();
    ctx.moveTo(0, row * BLOCK_SIZE);
    ctx.lineTo(canvas.width, row * BLOCK_SIZE);
    ctx.stroke();
  }
}

function drawBoard() {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = board[row][col];
      if (cell) {
        drawCell(ctx, col, row, TETROMINOS[cell].color, BLOCK_SIZE);
      }
    }
  }
}

function drawPiece(piece) {
  if (!piece) return;

  piece.shape.forEach((rowCells, dy) => {
    rowCells.forEach((filled, dx) => {
      if (filled) {
        drawCell(ctx, piece.col + dx, piece.row + dy, piece.color, BLOCK_SIZE);
      }
    });
  });
}

function draw() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawGrid();
  drawBoard();
  if (!gameOver) {
    drawPiece(currentPiece);
  }
}

// ============================================================
// 그리기 — 다음 블록 미리보기
// ============================================================

function drawNextPreview() {
  nextCtx.fillStyle = '#000';
  nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);

  if (!nextPieceType) return;

  const { shape, color } = TETROMINOS[nextPieceType];
  const offsetCol = Math.floor((4 - shape[0].length) / 2);
  const offsetRow = Math.floor((4 - shape.length) / 2);

  shape.forEach((rowCells, dy) => {
    rowCells.forEach((filled, dx) => {
      if (filled) {
        drawCell(nextCtx, offsetCol + dx, offsetRow + dy, color, NEXT_CELL_SIZE);
      }
    });
  });
}

// ============================================================
// 게임 시작
// ============================================================
resetGame();
