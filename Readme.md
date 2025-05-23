run npm install -g  against packages.json file in current directory //NB ENSURE YOU INSTALL GLOBALLY EACH TIME YOU WANT TO USE A DIFFERENT API CDM GENERATOR

export target postman API collection to current directory

execute
newman run postman_collection.json -r cli,dal-gen --reporter-dal-gen "C:\temp\New folder\output"

Models generated with schema in current dir

Enjoy ;)