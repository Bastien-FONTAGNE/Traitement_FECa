const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const cors = require('cors');
const bodyParser = require('body-parser');
const iconv = require('iconv-lite');

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const upload = multer({ dest: './temp/' });

app.listen(port, () => {
    console.log(`Serveur fonctionnant sur le port ${port}`);
});

const expectedColumns = [
    "JournalCode", "JournalLib", "EcritureNum", "EcritureDate", "CompteNum",
    "CompteLib", "CompAuxNum", "CompAuxLib", "PieceRef", "PieceDate",
    "EcritureLib", "Debit", "Credit", "EcritureLet", "DateLet",
    "ValidDate", "Montantdevise", "Idevise"
];

function importation(fichier, delimiter) {
    fs.writeFileSync('./temp/Temp.csv', '');
    
    let buffer = fs.readFileSync(fichier);

    let contenu = iconv.decode(buffer, 'utf-8');

    contenu = contenu.replace(/�c/g, 'éc')
                     .replace(/�v/g, 'év')
                     .replace(/�t/g, 'ût')
                     .replace(/�/g, 'e'); 

    if (delimiter === 'tab') {
        contenu = contenu.replace(/\t/g, ';');
    } else if (delimiter === '|') {
        contenu = contenu.replace(/\|/g, ';');
    } else if (delimiter === ';') {
        contenu = contenu.replace(/;/g, ';');
    }

    contenu = contenu.replace(/,/g, '.');

    // Vérifier et supprimer la première ligne si elle commence par "JournalCode"
    let lignes = contenu.split('\n');
    if (lignes.length > 0 && lignes[0].startsWith("JournalCode")) {
        lignes.shift(); // Supprimer la première ligne
    }

    // Ajouter les en-têtes spécifiées
    lignes.unshift(expectedColumns.join(';'));
    contenu = lignes.join('\n');
    
    fs.writeFileSync('./temp/Temp.csv', contenu, 'utf-8');
    
    fs.unlink(fichier, (err) => {
        if (err) {
            console.log('Erreur lors de la suppression du fichier temporaire', err);
        }
    });
}

app.post('/import', upload.single('file-path'), (req, res) => {
    const { delimiter } = req.body;
    const tempPath = req.file.path;
    
    importation(tempPath, delimiter);
    res.json({ status: "ok" });
});

app.post('/export', (req, res) => {
    const { format } = req.body;
    const tempFilePath = path.join(__dirname, 'temp', 'Temp.csv');
    
    if (!format) {
        return res.status(400).json({ error: 'Format requis.' });
    }
    
    const outputFilePath = path.join(__dirname, 'temp', `export.${format === 'text' ? 'txt' : 'csv'}`);
    
    fs.readFile(tempFilePath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).json({ error: 'Erreur lors de la lecture du fichier.' });
        }

        // Remplacer les points par des virgules dans les chiffres
        const transformedData = data.replace(/\b(\d+)\.(\d+)\b/g, '$1,$2');

        fs.writeFile(outputFilePath, transformedData, 'utf8', (err) => {
            if (err) {
                return res.status(500).json({ error: 'Erreur lors de l\'écriture du fichier.' });
            }

            res.download(outputFilePath, (err) => {
                if (err) {
                    console.error('Erreur durant le téléchargement du fichier:', err);
                    res.status(500).json({ error: 'Erreur durant le téléchargement du fichier' });
                }
                fs.unlink(outputFilePath, (err) => {
                    if (err) console.error('Erreur pendant la suppression du fichier:', err);
                });
            });
        });
    });
});

app.post('/correct-line', (req, res) => {
    const { lineNumber, correctedLine } = req.body;
    const filePath = path.join(__dirname, 'temp', 'Temp.csv');
    
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).json({ error: 'Erreur lors de la lecture du fichier.' });
        }
        
        const lines = data.split('\n');
        if (lineNumber - 1 < lines.length) {
            lines[lineNumber - 1] = correctedLine;
        } else {
            return res.status(400).json({ error: 'Numéro de ligne hors limites.' });
        }
        
        const updatedData = lines.join('\n');
        
        fs.writeFile(filePath, updatedData, 'utf8', (err) => {
            if (err) {
                return res.status(500).json({ error: 'Erreur lors de l\'écriture du fichier.' });
            }
            res.json({ message: `Ligne ${lineNumber} corrigée avec succès.` });
        });
    });
});

const isValidDate = (date) => {
    return /^\d{4}-\d{2}-\d{2}$/.test(date);
};

const convertDate = (date) => {
    if (/^\d{8}$/.test(date)) {
        return `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}`;
    }
    return date;
};

const isValidNumber = (num) => {
    return !isNaN(parseFloat(num)) && isFinite(num);
};

const verifyFEC = async (filePath, callback) => {
    try {
        const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });

        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        let lineNumber = 0;
        let headers = [];
        let errors = [];
        let linesWithErrors = [];
        let ecritureDateSums = {};
        let differences = {};

        for await (const line of rl) {
            lineNumber++;
            const columns = line.split(';');

            if (lineNumber === 1) {
                headers = columns;
                if (headers.length !== expectedColumns.length) {
                    errors.push(`Erreur: Le fichier doit contenir exactement ${expectedColumns.length} colonnes.`);
                }
                headers.forEach((header, index) => {
                    if (header.trim() !== expectedColumns[index]) {
                        errors.push(`Erreur: La colonne ${index + 1} doit être "${expectedColumns[index]}" mais est "${header.trim()}"`);
                    }
                });
                continue;
            }

            let lineErrors = [];

            if (columns.length !== expectedColumns.length) {
                lineErrors.push(`Nombre de colonnes incorrect (${columns.length}).`);
            } else {
                const [journalCode, journalLib, ecritureNum, ecritureDate, compteNum, compteLib, compAuxNum, compAuxLib,
                    pieceRef, pieceDate, ecritureLib, debit, credit, ecritureLet, dateLet, validDate, montantdevise, idevise] = columns;

                const convertedEcritureDate = convertDate(ecritureDate);
                const convertedPieceDate = pieceDate ? convertDate(pieceDate) : '';
                const convertedDateLet = dateLet ? convertDate(dateLet) : '';
                const convertedValidDate = validDate ? convertDate(validDate) : '';

                if (!isValidDate(convertedEcritureDate)) {
                    lineErrors.push(`Format de date incorrect pour EcritureDate (colonne 4: ${ecritureDate}).`);
                }
                if (pieceDate && !isValidDate(convertedPieceDate)) {
                    lineErrors.push(`Format de date incorrect pour PieceDate (colonne 10: ${pieceDate}).`);
                } else if (pieceDate && convertedPieceDate > convertedEcritureDate) {
                    lineErrors.push(`PieceDate (colonne 10: ${pieceDate}) ne doit pas être postérieure à EcritureDate (colonne 4: ${ecritureDate}).`);
                }
                if (dateLet && !isValidDate(convertedDateLet)) {
                    lineErrors.push(`Format de date incorrect pour DateLet (colonne 14: ${dateLet}).`);
                } else if (dateLet && convertedDateLet < convertedEcritureDate) {
                    lineErrors.push(`DateLet (colonne 14: ${dateLet}) ne doit pas être antérieure à EcritureDate (colonne 4: ${ecritureDate}).`);
                }
                if (validDate && !isValidDate(convertedValidDate)) {
                    lineErrors.push(`Format de date incorrect pour ValidDate (colonne 16: ${validDate}).`);
                }

                if (!isValidNumber(debit)) {
                    lineErrors.push(`Valeur de débit incorrecte (colonne 12: ${debit}).`);
                }

                if (!isValidNumber(credit)) {
                    lineErrors.push(`Valeur de crédit incorrecte (colonne 13: ${credit}).`);
                }

                if (parseFloat(debit) !== 0 && parseFloat(credit) !== 0) {
                    lineErrors.push(`Débit et Crédit ne peuvent pas tout les deux avoir une valeur sur la même ligne`);
                }

                if (lineErrors.length === 0) {
                    const key = `${ecritureNum}-${ecritureDate}`;
                    if (!ecritureDateSums[key]) {
                        ecritureDateSums[key] = { debit: 0, credit: 0, lines: [] };
                    }
                    ecritureDateSums[key].debit += parseFloat(debit);
                    ecritureDateSums[key].credit += parseFloat(credit);
                    ecritureDateSums[key].lines.push({ lineNumber, line });
                }
            }

            if (lineErrors.length > 0) {
                linesWithErrors.push({ lineNumber, line, errors: lineErrors });
            }
        }

        for (const [key, { debit, credit, lines }] of Object.entries(ecritureDateSums)) {
            const difference = debit - credit;
            const absDifference = Math.abs(difference).toFixed(2);
            if (difference !== 0 && absDifference > 0.01) {
                const [ecritureNum, ecritureDate] = key.split('-');
                const error = `Erreur: La somme des débits (${debit.toFixed(2)}) ne correspond pas à la somme des crédits (${credit.toFixed(2)}) pour l'écriture numéro ${ecritureNum} à la date ${ecritureDate} (différence: ${difference.toFixed(2)}).`;
                errors.push(error);
                lines.forEach(({ lineNumber, line }) => {
                    const lineIndex = linesWithErrors.findIndex(line => line.lineNumber === lineNumber);
                    if (lineIndex === -1) {
                        linesWithErrors.push({ lineNumber, line, errors: [error] });
                    } else {
                        linesWithErrors[lineIndex].errors.push(error);
                    }
                });
                if (!differences[absDifference]) {
                    differences[absDifference] = { positive: [], negative: [] };
                }
                if (difference > 0) {
                    differences[absDifference].positive.push({ ecritureNum, ecritureDate, debit, credit, lines });
                } else {
                    differences[absDifference].negative.push({ ecritureNum, ecritureDate, debit, credit, lines });
                }
            }
        }

        if (errors.length === 0 && linesWithErrors.length === 0) {
            errors.push("Le fichier FEC est correct.");
        } else {
            differences = Object.entries(differences).sort(([a], [b]) => parseFloat(a) - parseFloat(b)).reduce((acc, [key, value]) => {
                acc[key] = value;
                return acc;
            }, {});

            errors = [];
            for (const [absDiff, { positive, negative }] of Object.entries(differences)) {
                if (positive) {
                    positive.forEach(({ ecritureNum, ecritureDate, debit, credit }) => {
                        errors.push(`Erreur: La somme des débits (${debit.toFixed(2)}) ne correspond pas à la somme des crédits (${credit.toFixed(2)}) pour l'écriture numéro ${ecritureNum} à la date ${ecritureDate} (différence: ${absDiff}).`);
                    });
                }
                if (negative) {
                    negative.forEach(({ ecritureNum, ecritureDate, debit, credit }) => {
                        errors.push(`Erreur: La somme des débits (${debit.toFixed(2)}) ne correspond pas à la somme des crédits (${credit.toFixed(2)}) pour l'écriture numéro ${ecritureNum} à la date ${ecritureDate} (différence: -${absDiff}).`);
                    });
                }
            }
            errors.push("Vérification terminée avec des erreurs.");
        }

        console.log("Résultat de la vérification:", { errors, linesWithErrors, differences });
        callback(null, { errors, linesWithErrors, differences });
    } catch (err) {
        console.log(err);
        callback(err, null);
    }
};

app.get('/verify', (req, res) => {
    const tempPath = './temp/Temp.csv';

    verifyFEC(tempPath, (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Echec de la verification.', details: err });
        } else {
            console.log("Envoi du résultat:", result);  
            return res.status(200).json({ message: 'Verification réussie.', result: result });
        }
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index2.html'));
});
