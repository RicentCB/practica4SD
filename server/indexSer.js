
const net = require('net');
const Swal = require('sweetalert2');
const { remote } = require('electron');
const fs = require('fs');

const args = remote.getGlobal('args');

const serverInfo = {
    host: "localhost",
    port: args.port
}

import { updateClockDom, appendLogClock } from '../common/utils.js';
import Db from "./db.js";

var mainClockWorker;
var thisClock;
var peers = [];
var server;
var db;

var time_server;
var timeResponses = [];

export default function main() {
    db = new Db(args.uri, args.db);
    initClock();
    initServer();
    initComponents();
}

let lastSec = 0;
function initClock() {
    mainClockWorker = new Worker('../common/worker.js', { type: "module" });
    //Reloj Maestro
    mainClockWorker.onmessage = e => {
        thisClock = e.data;
        updateClockDom(document.querySelector(".clock"), e.data);
        //Actualizar log de hora
        if (lastSec != e.data?.seconds) {
            appendLogClock(document.querySelector('.log-clock'), e.data);
            lastSec = e.data?.seconds;
        }
    };
    mainClockWorker.postMessage({
        name: "Reloj Maestro"
    });
}

function initComponents() {
    // Modal para editar reloj
    const modalEdit = document.querySelector("#modal-edit-clock");

    // Boton para editar el reloj
    document.querySelector('#clock-s a.edit-clock').addEventListener('click', e => {
        e.preventDefault();
        //Detener reloj
        mainClockWorker.postMessage({ action: 'stop' })
        // Modificar valores del modal
        modalEdit.querySelector(".hours input").value = thisClock.hours;
        modalEdit.querySelector(".mins input").value = thisClock.minutes;
        modalEdit.querySelector(".secs input").value = thisClock.seconds;
        //Abrir modal
        modalEdit.classList.add('show');
    });
    //Cancelar editar hora en modal
    modalEdit.querySelector("a.button.cancel").addEventListener('click', e => {
        e.preventDefault();
        mainClockWorker.postMessage({ action: 'resume' });
        modalEdit.classList.remove('show');
    });

    //Aceptar cambio
    modalEdit.querySelector("a.button.accept").addEventListener("click", e => {
        e.preventDefault();
        let newHours = Number(modalEdit.querySelector("h1.hours input").value);
        let newMins = Number(modalEdit.querySelector("h1.mins input").value);
        let newSecs = Number(modalEdit.querySelector("h1.secs input").value);
        const time = {
            hours: newHours,
            mins: newMins,
            secs: newSecs,
            millis: 0
        };
        // Cambiar reloj
        mainClockWorker.postMessage({
            action: 'setTime',
            time: time,
        });

        //Cerrar modal
        modalEdit.classList.remove('show');
    });

    //Click en ventana para salir del editor
    modalEdit.addEventListener("click", e => {
        if (e.target.classList.contains('show')) {
            mainClockWorker.postMessage({ action: 'resume' });
            modalEdit.classList.remove('show');
        }
    });

    // Boton para reiniciar el servidor
    document.querySelector('.button#btn-reset-all').addEventListener("click", e => {
        e.preventDefault();
        resetSession();
    });

}

function sendToAllPeers(response) {
    for (let peer of peers) {
        peer.write(JSON.stringify(response));
    }
}

function requestBook(conn) {
    db.getRandomBook().then(book => {
        console.log(book);
        sendToAllPeers({
            type: "responseBookServer",
            info: {
                book: book,
                origin: conn.remoteAddress
            }
        });

        conn.write(
            JSON.stringify(
                {
                    type: "responseBook",
                    info: {
                        book: book,
                    }
                }
            )
        );

        db.logRequest(conn.remoteAddress, book.isbn).catch(console.error);
        fillInfoBook(book);
    }).catch(err => {
        conn.write(JSON.stringify({
            type: "error",
            info: {
                error_msg: "Error al obtener un libro prestado."
            }
        }));
        console.error(err);
    });
}

function handleIncomingData(conn, data) {
    let msg = JSON.parse(data.toString());
    console.log(msg);
    if (msg?.type === "requestGlobalStatus") {
        Promise.all([db.getBooks(), db.getLogs()])
            .then(([r1, r2]) => {
                conn.write(JSON.stringify({
                    type: "responseGlobalStatus",
                    info: {
                        books: r1,
                        logs: r2
                    }
                }));
            }).catch(console.error);
    } else if (msg?.type === "responseGlobalStatus") {
        let books = msg.info.books;
        let logs = msg.info.logs;
        // console.log(books);
        // console.log(logs);
        db.setBooksBatch(books).then(() => {
            return showAllAvailableBooks();
        })
            .catch(console.error);
        db.logRequestBatch(logs).catch(console.error);
    } else if (msg?.type === "requestBook") {
        requestBook(conn);
    } else if (msg?.type === "responseBookServer") {
        db.setBorrowedBook(msg.info.book.isbn).catch(console.error);
        db.logRequest(msg.info.origin, msg.info.book.isbn).catch(console.error);
        fillInfoBook(msg.info.book);
    } else if (msg?.type === "offsetPeers") {
        let offsets = msg.data.offsets;
        mainClockWorker.postMessage({
            action: "offsetClock",
            offset: offsets[0],
        });
        for (let i = 0; i < offsets.length - 1; i++) {
            peers[i].write(JSON.stringify({
                type: "offsetClock",
                data: {
                    offset: offsets[i + 1]
                }
            }));
        }
    } else if (msg?.type === 'offsetClock') {
        console.log(msg.data.offset);
        mainClockWorker.postMessage({
            action: "offsetClock",
            offset: msg.data.offset,
        });
    } else if (msg?.type === "timerequest") {
        timeResponses.push(thisClock);
        if (peers.length == 1) {
            conn.write(JSON.stringify(thisClock));
        }
        time_server = conn;
        //TODOm send to all peers
        sendToAllPeers({ type: "timerequestunique" });
        // modificar los clientes
    } else if (msg?.type === "timerequestunique") {
        conn.write(JSON.stringify({
            type: "timeresponse",
            data: {
                clock: thisClock
            }
        }));
    } else if (msg?.type === "timeresponse") {
        console.log("Hora recibida");
        timeResponses.push(msg.data.clock);
        if (peers.length <= timeResponses.length) {
            console.log(timeResponses);
            time_server.write(JSON.stringify({
                type: "timeServerResponse",
                data: {
                    times: timeResponses
                }
            }));
            timeResponses = [];
        }
    } else if (msg?.type === "resetSession") {
        resetSessionUnique();
    }
}

function initServer() {
    // handle sockets
    fs.readFile('./server/serverList.json', 'utf-8', (err, data) => {
        let getGlobalStatus = true;
        if (err) {
            return console.error(err);
        }
        // try connecting with peers
        let peerList = JSON.parse(data);
        peerList.peers.forEach(peer => {
            if (peer.host === serverInfo.host && peer.port === serverInfo.port) {
                return;
            }
            let peerInfo = `${peer.host}:${peer.port}`;
            let socket = new net.Socket();
            socket.connect(peer, () => {
                console.log(`connected to peer ${peerInfo}`);
                peers.push(socket);
                if (getGlobalStatus) {
                    socket.write(JSON.stringify({
                        type: "requestGlobalStatus"
                    }));
                    getGlobalStatus = false;
                }
            });
            socket.on('data', (buf) => {
                handleIncomingData(socket, buf);
            });
            socket.on('error', err => {
                if (err.name === 'ECONNREFUSED') {
                    console.log(`peer ${peerInfo} not available`);
                }
            });
            socket.on('end', () => {
                console.log(`disconnected from peer ${peerInfo}`);
            });
        });
        if (getGlobalStatus) {
            showAllAvailableBooks().catch(console.error);
        }

        // create a TCP server for new peers to connect to
        if (!peerList.peers.some(peer => peer.host === serverInfo.host && peer.port === serverInfo.port)) {
            peerList.peers.push(serverInfo);
        }
        server = net.createServer(c => {

            let client = `${c.remoteAddress}:${c.remotePort}`;
            console.log(`${client} connected`);

            // event delegation for current connections
            c.on('data', (buf) => {
                handleIncomingData(c, buf);
            });
            c.on('close', () => {
                console.log(`${client} disconnected`);
                let idx = peers.indexOf(c);
                if (idx !== -1) {
                    peers.splice(idx, 1);
                }
            });
            c.on('error', err => {
                if (err.name !== 'ECONNRESET') {
                    console.error(err);
                }
            });

            peers.push(c);
        });
        server.on('error', (err) => {
            if (err.name === 'EADDRINUSE') {
                console.log('Address in use, retrying...');
                setTimeout(() => {
                    server.close();
                    server.listen(serverInfo.port);
                }, 1000);
            } else {
                throw err;
            }
        });
        server.listen(serverInfo.port, () => {
            let strServ = ' 1';
            if (serverInfo.port == 5502)
                strServ = ' 2';
            document.querySelector('#main-content h1').innerHTML = document.querySelector('#main-content h1').innerHTML + strServ;
            console.log(`server bound on ${serverInfo.host}:${serverInfo.port}`);
        });
        fs.writeFile('./server/serverList.json', JSON.stringify(peerList, null, 4), (err) => {
            if (err) return console.error(err);
            console.log("rewrote server list");
        });
    });
}

async function showAllAvailableBooks() {
    db.getAvailableBooks().then((books) => {
        const allBooksContainer = document.querySelector('.all-books');
        allBooksContainer.innerHTML =
            books.reduce((html, book) => {
                const { ISBN, autor, nombre } = book;
                return `${html}
                    <div class="book-title">
                     <h4>${nombre}</h4>
                     <p>${autor}</p>
                     <p>${ISBN}</p>
                 </div>`
            }, '');
    });
}

// Funcion que llena la interfaz con los datos de un libro
function fillInfoBook(value) {
    let lastBookContainer = document.querySelector('#last-book');
    //Alerta
    Swal.fire({
        title: 'Solicitud entrante',
        text: 'Un cliente ha solicitado un libro',
        icon: 'info',
        confirmButtonText: 'Aceptar'
    });
    //Adquirir datos
    const { nombre, autor, editorial, precio, ISBN, imagen } = value;
    lastBookContainer.querySelector("p#nombre span").innerHTML = nombre;
    lastBookContainer.querySelector("p#autor span").innerHTML = autor;
    lastBookContainer.querySelector("p#editorial span").innerHTML = editorial;
    lastBookContainer.querySelector("p#precio span").innerHTML = precio;
    lastBookContainer.querySelector("p#ISBN span").innerHTML = ISBN;
    lastBookContainer.querySelector("img#book-cover").setAttribute("src", `..${imagen}`);
    //Mostrar contenido
    lastBookContainer.classList.add('visible');
    //Actualizar los libros a prestar
    showAllAvailableBooks();

}

function resetSessionUnique() {
    let lastBookContainer = document.querySelector('#last-book');
    db.resetBooks().catch(console.error);

    showAllAvailableBooks();
    lastBookContainer.classList.remove('visible');
    //Alerta
    Swal.fire({
        title: 'Reinicio',
        text: 'Se ha reiniciado la sesion',
        icon: 'info',
        confirmButtonText: 'Aceptar'
    });
}

function resetSession() {
    resetSessionUnique();
    sendToAllPeers({
        type: "resetSession"
    })
}