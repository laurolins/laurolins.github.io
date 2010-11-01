all:
	scp index.html shell.sci.utah.edu:~/public_html/.
	scp -r images shell.sci.utah.edu:~/public_html/.