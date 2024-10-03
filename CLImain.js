const { Client } = require('pg');
const fs = require('fs');
const readline = require('readline');
const path = require('path');
const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const client = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'fec',
    password: 'azerty',
    port: 5433,
})

client.connect(function(err) {
    if (err) throw err;
});

function importation() {
    let fichier = "";
    let delimiter = "";
    let format = "";
    
    client.query("SELECT * FROM fec" , (err, res) => {
        if (err) {
            console.error(err);
        } else {
            if(res.rowCount !== 0) {
                client.query('TRUNCATE TABLE public.fec;');
            }
        }
    });
    
    rl.question(`Coller le chemin d'acces du fichier : `, (path) => {   
        
        path = path.replace(/"/g, "");
        
        if(fs.existsSync(path)) fichier = path;
        else {
            console.log("Fichier inexistant, veillez à bien entrer le chemin du fichier\n");
            return importation();
        }
        
        rl.question(`Choisissez le format du fichier : (text ou csv)`, (formatInput) => {
            console.log(`format choisi : ${formatInput}`)
            
            if (formatInput == 'text') {
                format = 'TEXT';               
            } else if (formatInput == 'csv') {
                format = 'CSV';
            } else {
                console.log('Format inconnu, choisissez text ou CSV');
            }
            
            rl.question("Quel est votre delimiteur ? (tab, | ou ; [.csv = ;])", (delimiterInput) => {
                
                if(delimiterInput == 'tab'){
                    delimiter = `E'\\t'`;
                } else if (delimiterInput == '|') {
                    delimiter = "'|'";
                }else if(delimiterInput == ';') {
                    delimiter = "';'";
                } else {
                    console.log('Le delimiteur que vous avez choisi n\' est pas pris en charge, chosissez tab ou | ');
                }
                
                const query = `copy public.fec (journalcode, journallib, ecriturenum, ecrituredate, comptenum, comptelib, compauxnum, compauxlib, pieceref, piecedate, ecriturelib, debit, credit, ecriturelet, datelet, validdate, montantdevise, idevise)
                FROM 'C:/Users/admin/Desktop/traitement_FEC/temp/Temp.text'
                WITH (FORMAT ${format}, DELIMITER ${delimiter}, NULL '');`
                
                //remplace les virgules par des points
                fs.writeFileSync('./temp/Temp.text', fs.readFileSync(fichier, 'utf-8').replace(/,/g, '.'), 'utf-8');
                
                //Supprime les en-têtes
                let head = ["JournalCode","JournalLib","EcritureNum","EcritureDate","CompteNum","CompteLib","CompAuxNum","CompAuxLib","PieceRef","PieceDate","EcritureLib","Debit","Credit","EcritureLet","DateLet","ValidDate","Montantdevise","Idevise"];
                let contenu = fs.readFileSync("./temp/Temp.text", 'utf-8');
                if(delimiter == "';'"){
                    const lines = contenu.split('\n');
                    contenu = lines.slice(2).join('\n');
                }
                let regex = new RegExp('\\b(' + head.join('|') + ')\\b', 'g');
                contenu = contenu.replace(regex, '');
                
                fs.writeFileSync('./temp/Temp.text', contenu, 'utf-8');
                
                client.query(query, (err, res) => {
                    if (err) {
                        console.error(err);
                    } else {
                        console.log(`${res.rowCount} lignes importées`);
                    }
                    menu();
                });
            });
        });
    })
}

function exportation() {
    let format = ""
    let query 
    
    rl.question('En quel format souhaitez vous exporter le fichier ? (text ou csv)', (formatInput) => {
        console.log(`Format choisi : ${formatInput}`)
        
        if (formatInput == 'text'){
            format = 'TEXT'
            query = `copy public.fec (journalcode, journallib, ecriturenum, ecrituredate, comptenum, comptelib, compauxnum, compauxlib, pieceref, piecedate, ecriturelib, debit, credit, ecriturelet, datelet, validdate, montantdevise, idevise) 
            TO 'C:/Users/admin/Desktop/TRAITE~1/temp/fec_export.text' 
            DELIMITER E'\\t' ENCODING 'UTF8' NULL '\"\"';`
        }else if (formatInput == 'csv'){
            format = 'CSV';
            query =  `copy public.fec (journalcode, journallib, ecriturenum, ecrituredate, comptenum, comptelib, compauxnum, compauxlib, pieceref, piecedate, ecriturelib, debit, credit, ecriturelet, datelet, validdate, montantdevise, idevise) 
            TO 'C:/Users/admin/Desktop/TRAITE~1/temp/fec_export.csv' 
            DELIMITER ';' CSV HEADER ENCODING 'UTF8' QUOTE '\"' ESCAPE '''';`
            
        } else {
            console.log('format non supporté');
            return exportation();
        }
        
        client.query(query, (err) => {
            if (err) {
                console.error(err);
            }            
        });
        
        rl.question('Dans quel dossier souhaitez vous enregistrer votre fichier ?', (path)=> {
            path = path.replace(/"/g, "");
            
            rl.question('Quel est le nom de votre fichier?', (nom)=> {
                fs.rename('./temp/fec_export.'+ format, path + "/"+ nom + "." + format.toLowerCase(), (err) => {
                    if (err) {
                        console.log('Erreur lors du nommage du fichier', err);
                    }
                    else { 
                        console.log('Le fichier à été enregistré avec succès');
                        menu();
                    }
                });
            })
        })
    })
}

function verification() {
    var resultats = {
        debit_credit : ''
    }
    const query = "SELECT SUM(debit) - SUM(credit) AS total FROM public.fec"
    client.query(query, (err,res) => {
        if(err) console.error("Erreur lors de la verification", err);
        const total = res.rows[0].total;
        if(total === null) {
            console.log("Aucun fichier enregistré, veuillez importer un fichier pour pouvoir vérifier");
            return menu();
        } else {
            if(total == 0) resultats.debit_credit = 'bon';
            else resultats.debit_credit = 'Pas bon';
            console.table(resultats);
            menu();
        }
    })
}

function quitter() {
    fs.writeFile('C:/Users/admin/Desktop/traitement_FEC/temp/Temp.text', '', (err) => {
        if(err) console.error(err);
    })
    const query = 'TRUNCATE TABLE public.fec;'
    client.query(query);
    rl.close();
    return process.exit(0);
}

function test50() {
    let tab = 
        {
            a : "ok",
            b : "ok",
            c : "ok"
        }
    tab.a = 'ab';
    tab.debit_credit = 'db';
    console.table(tab)
}

function menu() {
    rl.question('Que voulez vous faire ?\n[1] Importer un fichier\n[2] Exporter un fichier\n[3] Vérifier le fichier\n[4] Quitter\n', (choix) => {
        if(choix == 1) importation();
        else if(choix == 2) exportation();
        else if(choix == 3) verification();
        else if(choix == 4) quitter();
        else if(choix == 6) test50();
    })
}

function init() {
    client.query("SELECT * FROM fec" , (err, res) => {
        if (err) {
            console.error(err);
        } else {
            if(res.rowCount !== 0) {
                client.query('TRUNCATE TABLE public.fec;');
            }
        }
        menu();
    });
}

init();




/*document.getElementById('submit-import').addEventListener('click', function() {
    importation();
})*/