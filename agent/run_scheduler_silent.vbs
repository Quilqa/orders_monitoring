' Запускает scheduler.py без консольного окна (pythonw.exe), с рабочей директорией
' agent/, чтобы .env и относительные пути (logs/, pipelines/) резолвились верно.
' Используется из автозагрузки (shell:startup) — Task Scheduler недоступен на этой
' машине (Access is denied даже для собственных задач пользователя, видимо GPO).
Set fso = CreateObject("Scripting.FileSystemObject")
agentDir = fso.GetParentFolderName(WScript.ScriptFullName)

pythonw = "C:\Users\1\AppData\Local\Programs\Python\Python314\pythonw.exe"

Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = agentDir
' 0 = скрытое окно, False = не ждать завершения (сборщик работает бесконечно)
shell.Run """" & pythonw & """ scheduler.py", 0, False
