const net = require('net');
const Swal = require('sweetalert2');
const { ipcRenderer } = require('electron');
const fs = require('fs');

import { updateClockDom, appendLogClock } from '../common/utils.js';


const BookInfoContainer = document.querySelector('#book-container');

var mainClockWorker;
var socket;
var thisClock;

export default function main() {
    initClock();
    findServer();
    bindButtons();
}

function requestBookHdl(event) {
    event.preventDefault();
    requestBook();
    BookInfoContainer.querySelector('#btn-request-book').removeEventListener('click', requestBookHdl);
}

function bindButtons() {
    BookInfoContainer.querySelector('#btn-request-book').addEventListener('click', requestBookHdl);
    //Abrir modal para editar reloj
    // Modal para editar reloj
    const modalEdit = document.querySelector("#modal-edit-clock");

    // Boton para editar el reloj
    document.querySelector('a.edit-clock').addEventListener('click', e => {
        e.preventDefault();
        //Detener reloj
        mainClockWorker.postMessage({action: 'stop'})
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
        mainClockWorker.postMessage({action: 'resume'});
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
    modalEdit.addEventListener("click", e=>{
        if(e.target.classList.contains('show')){
            mainClockWorker.postMessage({action: 'resume'});
            modalEdit.classList.remove('show');
        }
    });
}
let lastSec=0;
function initClock() {
    mainClockWorker = new Worker('../common/worker.js', { type: "module" });
    //Reloj Cliente

    mainClockWorker.onmessage = e => {
        thisClock = e.data;
        updateClockDom(document.querySelector('.clock'), e.data);
        //Actualizar log de hora
        if(lastSec != e.data?.seconds){
            appendLogClock(document.querySelector('.log-clock'), e.data);
            lastSec = e.data?.seconds;
        }
    }
    mainClockWorker.postMessage({
        name: "Reloj"
    });
}

function configSocket() {
    let dataCallback = data => {
        const msg = JSON.parse(data.toString());
        console.log(msg);
        if (msg?.type === 'responseBook') {
            const book = msg.info?.book;
            showBook(book);
        } else if (msg?.type === 'resetSession') {
            socket.end();
        } else if (msg?.type === 'error') {
            //Alerta
            Swal.fire({
                title: 'Solicitud rechazada',
                text: 'No se encontró un libro disponible',
                icon: 'error',
                confirmButtonText: 'Cerrar'
            });
            BookInfoContainer.querySelector('#btn-request-book').addEventListener('click', requestBookHdl);
        } else if (msg?.type === "offsetClock") {
            console.log(msg.data.offset);
            mainClockWorker.postMessage({
                action: "offsetClock",
                offset: msg.data.offset,
            });
        } else if (msg?.type === 'requestTime'){
            console.log("Time requested");
            socket.write(JSON.stringify({
                type: "responseTime",
                data: {
                    clock: thisClock
                }
            }));
        }
    };
    let endCallback = () => {
        console.log("disconnected from server");
        BookInfoContainer.classList.remove("showing-info");
        BookInfoContainer.querySelector("#btn-request-book").classList.remove("disabled");

        //Alerta de cierree de esision
        Swal.fire({
            title: 'Sesion Finalizada',
            text: '¿Te gustaria continuar?',
            showDenyButton: true,
            confirmButtonText: 'Si, continuar',
            denyButtonText: 'No, salir',
        }).then((result) => {
            if (result.isConfirmed) {
                socket = null;
                //Alerta aceptada, continuar con la sesion
                findServer();
                BookInfoContainer.querySelector('#btn-request-book').addEventListener('click', requestBookHdl);
            } else {
                ipcRenderer.send("asynchronous-message", 'exit');
            }
        })
    };
    socket.on('data', dataCallback);

    socket.on('close', endCallback);

    socket.on('error', err => {
        if (err.code !== 'ECONNRESET') {
            console.error(err);
        }
    });
}

function findServer() {
    let i = 0;
    let handler;
    handler = setInterval(() => {
        fs.readFile('./client/serverList.json', 'utf-8', (err, data) => {
            if (err) {
                return console.error(err);
            }
            // try to connect with any server
            let serverList = JSON.parse(data);
            if (serverList?.servers?.length !== 0) {
                let len = serverList?.servers?.length;
                let sv = serverList.servers[i];

                i = (i + 1) % len;
                let sock = new net.Socket();
                let serverInfo = `${sv.host}:${sv.port}`;
                sock.connect(sv, () => {
                    console.log(`connected to server ${serverInfo}`);
                    socket = sock;
                    clearInterval(handler);
                    configSocket();
                });

                sock.on('error', err => {
                    if (err.name === 'ECONNREFUSED') {
                        console.log(`server ${serverInfo} not available`);
                    }
                });
            }
        });
    }, 2000);
}

// Despliegue de información de libro
function showBook(value) {
    //Alerta
    Swal.fire({
        title: 'Solicitud aceptada',
        text: 'El prestamo ha sido autorizado',
        icon: 'success',
        confirmButtonText: 'Aceptar'
    });
    const infoBook = BookInfoContainer.querySelector(".information");
    const { ISBN, autor, editorial, nombre, precio } = value;
    //Rellenar informacion
    infoBook.querySelector("p#nombre span").innerHTML = nombre;
    infoBook.querySelector("p#autor span").innerHTML = autor;
    infoBook.querySelector("p#editorial span").innerHTML = editorial;
    infoBook.querySelector("p#precio span").innerHTML = precio;
    infoBook.querySelector("p#ISBN span").innerHTML = ISBN;
    //Mostrar Contenedor
    BookInfoContainer.classList.add("showing-info");
    //Desactivar boton de pedir libro
    BookInfoContainer.querySelector("#btn-request-book").classList.add("disabled");
}

function reset() {
    let request = {
        type: "reset"
    };
    socket.write(JSON.stringify(request));
}

function requestBook() {
    let request = {
        type: "requestBook"
    }
    socket.write(JSON.stringify(request));
}

function enableReset() {
    BookInfoContainer.querySelector('btn-reset').addEventListener('click', resetSessions = (event)=>{
        event.preventDefault();
        reset();
    });
}