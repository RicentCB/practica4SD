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
var peers = [];
var server;
var db;

export default function main() {
    db = new Db(args.uri, args.db);
    initClock();
    initServer();
    initComponents();
}

let lastSec=0;
function initClock() {
    mainClockWorker = new Worker('../common/worker.js', { type: "module" });
    //Reloj Maestro
    mainClockWorker.onmessage = e => {
        updateClockDom(document.querySelector(".clock"), e.data);
        //Actualizar log de hora
        if(lastSec != e.data?.seconds){
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
        const ClockContainer = e.currentTarget.parentNode
        const currHours = Number(ClockContainer.querySelector("h1.hours").innerHTML);
        const currMins = Number(ClockContainer.querySelector("h1.mins").innerHTML);
        const currSecs = Number(ClockContainer.querySelector("h1.secs").innerHTML);
        // Modificar valores del modal
        modalEdit.querySelector(".hours input").value = currHours;
        modalEdit.querySelector(".mins input").value = currMins;
        modalEdit.querySelector(".secs input").value = currSecs;
        //Abrir modal
        modalEdit.classList.add('show');
    });
    //Cancelar editar hora en modal
    modalEdit.querySelector("a.button.cancel").addEventListener('click', e => {
        e.preventDefault();
        modalEdit.classList.remove('show');
    });

    //Aceptar cambio
    modalEdit.querySelector("a.button.accept").addEventListener("click", e => {
        e.preventDefault();
        let newHours = Number(modalEdit.querySelector("h1.hours input").value);
        let newMins = Number(modalEdit.querySelector("h1.mins input").value);
        let newSecs = Number(modalEdit.querySelector("h1.secs input").value);
        let time = {
            hours: newHours,
            mins: newMins,
            secs: newSecs,
        };
        // TODO:
        // Cambiar reloj
        mainClockWorker.postMessage({
            action: 'setTime',
            time: time,
        });

        //Cerrar modal
        modalEdit.classList.remove('show');
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
            type: "responseBook",
            info: {
                book: book,
                origin: conn.remoteAddress
            }
        });

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
        console.log(books);
        console.log(logs);
        db.setBooksBatch(books).then(() => {
            return showAllAvailableBooks();
        })
            .catch(console.error);
        db.setLogsBatch(logs).catch(console.error);
    } else if (msg?.type === "requestBook") {
        requestBook(conn);
    } else if (msg?.type === "responseBook") {
        db.setBorrowedBook(msg.info.book.isbn).catch(console.error);
        db.logRequest(msg.info.origin, msg.info.book.isbn).catch(console.error);
        fillInfoBook(book);
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
                if (err.code === 'ECONNREFUSED') {
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
                if (err.code !== 'ECONNRESET') {
                    console.error(err);
                }
            });

            peers.push(c);
        });
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.log('Address in use, retrying...');
                setTimeout(() => {
                    server.close();
                    server.listen(serverInfo.port);
                }, 1000);
            } else {
                throw err;
            }
        });
        server.listen(serverInfo, () => {
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

function resetSession() {
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